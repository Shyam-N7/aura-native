package com.auranative

import android.app.Application
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
    }
  }
}
