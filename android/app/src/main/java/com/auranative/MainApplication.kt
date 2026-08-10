package com.auranative

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import coil.Coil
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.memory.MemoryCache
import com.facebook.drawee.backends.pipeline.Fresco
import com.facebook.imagepipeline.cache.MemoryCacheParams
import com.facebook.imagepipeline.core.ImagePipelineConfig
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.shell.MainPackageConfig
import io.sentry.Breadcrumb
import io.sentry.Sentry
import io.sentry.SentryLevel

class MainApplication : Application(), ReactApplication, ImageLoaderFactory {

  override val reactHost: ReactHost by lazy {
    // Fresco (RN's image pipeline) budgets its decoded-bitmap cache from the
    // heap class — ~64MB on this device — and image-heavy browsing filled it:
    // Graphics measured 133MB PSS with player+queue open on a phone whose
    // kernel OOM-kills the biggest resident app. List art is 150px (~90KB
    // decoded), so 24MB still holds ~270 covers; onTrimMemory below drops
    // even that under pressure.
    val frescoConfig =
      ImagePipelineConfig.newBuilder(this)
        .setBitmapMemoryCacheParamsSupplier {
          MemoryCacheParams(
            24 * 1024 * 1024, // cache budget (bytes)
            192, // max entries
            24 * 1024 * 1024, // eviction queue budget
            48, // eviction queue entries
            4 * 1024 * 1024, // largest single entry
          )
        }
        .build()
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this, MainPackageConfig(frescoConfig)).packages.apply {
          // The equalizer's platform-effects bridge — app-local, so nothing to
          // autolink.
          add(AuraEqualizerPackage())
          // Backdrop blur for the glass chrome — also app-local.
          add(GlassViewPackage())
          // Posts system notifications for pushes the OS won't draw itself
          // (foreground arrivals, and data-only payloads in the background).
          add(AuraNotifierPackage())
        },
    )
  }

  /**
   * Coil's singleton loader serves exactly one consumer here: KotlinAudio's
   * notification/lock-screen artwork (RN's own images go through Fresco).
   * Its default memory cache budgets ~25% of the app's memory class and
   * fills with one ~1.5MB hardware bitmap per played track — measured as
   * linear EGL/gralloc growth on long screen-off sessions, feeding the OOM
   * kills this app exists to avoid. A handful of covers is all the
   * notification ever needs; 8MB keeps back-skips instant and the GPU
   * memory flat.
   */
  override fun newImageLoader(): ImageLoader =
    ImageLoader.Builder(this)
      .memoryCache {
        MemoryCache.Builder(this)
          .maxSizeBytes(8 * 1024 * 1024)
          .build()
      }
      .build()

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    createPushChannel()
  }

  /**
   * The channel every FCM notification lands in. Without one declared, the
   * Firebase SDK invents its own fallback at whatever importance it chooses —
   * which on O+ is the difference between a push that lights a locked screen
   * and one the user never sees, and it shows up in system settings under a
   * generic name the user can't recognise as ours.
   *
   * Created here rather than from JS on purpose: a notification-type push is
   * rendered by the OS itself, and that can happen while the app is dead and
   * no JS context exists. Application.onCreate runs for that delivery too.
   * createNotificationChannel is idempotent, so re-running it is free — but
   * note the OS ignores importance changes to an EXISTING channel, so a later
   * change of mind needs a new id, not an edit.
   */
  private fun createPushChannel() {
    val channel =
      NotificationChannel(
        PUSH_CHANNEL_ID,
        getString(R.string.push_channel_name),
        NotificationManager.IMPORTANCE_HIGH,
      )
    channel.description = getString(R.string.push_channel_description)
    getSystemService(NotificationManager::class.java)
      ?.createNotificationChannel(channel)
  }

  companion object {
    /**
     * Mirrored in AndroidManifest (default_notification_channel_id) and in the
     * server's send payload (server/push.js). All three must agree.
     */
    const val PUSH_CHANNEL_ID = "aura.push.v1"
  }

  /**
   * This 5.5GB ColorOS device kernel-OOM-kills the biggest resident app under
   * pressure — twice observed at foreground importance. Cached bitmaps are
   * the one big block we can shed instantly, so drop them on every trim
   * signal from RUNNING_LOW up. That range includes UI_HIDDEN: exactly the
   * screen-off listening case, where the UI's image caches are dead weight
   * and survival is what matters.
   */
  override fun onTrimMemory(level: Int) {
    super.onTrimMemory(level)
    if (level >= TRIM_MEMORY_RUNNING_LOW) {
      if (Fresco.hasBeenInitialized()) {
        Fresco.getImagePipeline().clearMemoryCaches()
      }
      Coil.imageLoader(this).memoryCache?.clear()
      reportTrim(level)
    }
  }

  /**
   * The OS telling us it is about to reclaim from us is the single best memory
   * signal this app can get, and until now it was consumed to clear caches and
   * then dropped. Nothing in a release build measures memory — on the app whose
   * list window is capped BECAUSE of an OOM kill (reports/10-leak-and-kill).
   *
   * Why CRITICAL and COMPLETE are events and not just breadcrumbs: an OOM kill
   * is a SIGKILL. There is no crash to attach breadcrumbs to and no chance to
   * flush on the way down — a breadcrumb describing the last moments dies with
   * the process that recorded it. The trim has to leave the device while we are
   * still alive to send it, or it is not evidence of anything.
   *
   * io.sentry is reachable here because @sentry/react-native declares
   * sentry-android with `api`, not `implementation` (its android/build.gradle),
   * so it lands on this module's compile classpath transitively. The hub is
   * started from JS, so before Sentry.init lands these calls are no-ops rather
   * than errors — which is the correct behaviour for a trim that early.
   *
   * Wrapped whole: telemetry must never throw into the app.
   */
  private fun reportTrim(level: Int) {
    try {
      val name = when (level) {
        TRIM_MEMORY_RUNNING_LOW -> "running-low"
        TRIM_MEMORY_RUNNING_CRITICAL -> "running-critical"
        TRIM_MEMORY_UI_HIDDEN -> "ui-hidden"
        TRIM_MEMORY_BACKGROUND -> "background"
        TRIM_MEMORY_MODERATE -> "moderate"
        TRIM_MEMORY_COMPLETE -> "complete"
        else -> "level-$level"
      }
      // RUNNING_CRITICAL is "about to be killed while the user is watching".
      //
      // COMPLETE is "first in line among CACHED processes" — and that is not
      // the screen-off listening case, whatever it looks like. During playback
      // this process holds a foreground service, so it is not cached and this
      // level is never delivered to it (reports/10 records the kill happening
      // at oom_adj 200 / proc_state 4, not from the cached tier). It fires when
      // the user has genuinely left: no service, app in the background, about
      // to be reclaimed and lose its state. Worth an event for the restore
      // path, not for the listening one.
      if (level == TRIM_MEMORY_RUNNING_CRITICAL || level == TRIM_MEMORY_COMPLETE) {
        Sentry.captureMessage("memory-trim: $name", SentryLevel.WARNING)
      } else {
        Sentry.addBreadcrumb(Breadcrumb().apply {
          category = "memory"
          message = "trim: $name"
          this.level = SentryLevel.INFO
        })
      }
    } catch (_: Throwable) {
      // never
    }
  }
}
