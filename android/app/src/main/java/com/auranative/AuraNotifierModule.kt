package com.auranative

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.atomic.AtomicInteger

/**
 * Posts a system notification on behalf of JS.
 *
 * Why this exists: FCM draws a `notification` payload itself ONLY while the app
 * is backgrounded or dead. With the app in the FOREGROUND the message is handed
 * to JS instead, and react-native-firebase offers no way to put it back in the
 * shade — so a broadcast that arrived while the user had AURA open surfaced as
 * an in-app toast and nothing else. The in-app quiet panel is for presence and
 * resume offers; a broadcast belongs in the phone's notification panel like any
 * other notification. Data-only pushes have the same gap in the background
 * handler, which had nothing to draw with either.
 *
 * App-local module, same as the equalizer and glass bridges — ~70 lines of
 * NotificationCompat rather than a new native dependency.
 */
class AuraNotifierModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = NAME

  /**
   * @param link an in-app URL (https://…/t/<id>, /p/<id>, ?join=…) or null.
   * Resolves true when the notification was handed to the system, false when it
   * could not be (notifications switched off, permission never granted) so the
   * JS half can fall back rather than assume it landed.
   */
  @ReactMethod
  fun display(title: String?, body: String?, link: String?, promise: Promise) {
    try {
      val manager = NotificationManagerCompat.from(reactContext)
      // The honest answer on 33+, where POST_NOTIFICATIONS may never have been
      // granted: notify() is a silent no-op there, and a silent no-op is the
      // exact failure this module exists to stop.
      if (!manager.areNotificationsEnabled()) {
        promise.resolve(false)
        return
      }

      val id = nextId.getAndIncrement()

      // Route the tap through the SAME path a shared link takes: ACTION_VIEW on
      // our own https host matches MainActivity's intent filter, so RN's Linking
      // delivers it and App.handleLink does the rest. No second routing table,
      // and a tap from a cold start behaves like any other link because
      // getInitialURL() sees it too.
      val intent =
        link
          ?.takeIf { it.isNotBlank() }
          ?.let { Intent(Intent.ACTION_VIEW, Uri.parse(it)).setPackage(reactContext.packageName) }
          ?: reactContext.packageManager.getLaunchIntentForPackage(reactContext.packageName)
      intent?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)

      val pendingIntent =
        intent?.let {
          PendingIntent.getActivity(
            reactContext,
            id,
            it,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
          )
        }

      val text = body ?: ""
      val notification =
        NotificationCompat.Builder(reactContext, MainApplication.PUSH_CHANNEL_ID)
          .setSmallIcon(R.drawable.ic_launcher_monochrome)
          .setColor(ContextCompat.getColor(reactContext, R.color.push_accent))
          .setContentTitle(title ?: "")
          .setContentText(text)
          // Broadcast copy runs longer than one line more often than not.
          .setStyle(NotificationCompat.BigTextStyle().bigText(text))
          .setPriority(NotificationCompat.PRIORITY_HIGH)
          .setAutoCancel(true)
          .apply { pendingIntent?.let { setContentIntent(it) } }
          .build()

      manager.notify(id, notification)
      promise.resolve(true)
    } catch (e: SecurityException) {
      // POST_NOTIFICATIONS revoked between the check above and the post.
      promise.resolve(false)
    } catch (e: Exception) {
      promise.reject("notify_failed", e)
    }
  }

  companion object {
    const val NAME = "AuraNotifier"

    // KotlinAudio's media notification holds id 1; start well clear of it and
    // let broadcasts stack rather than replace one another.
    private val nextId = AtomicInteger(4200)
  }
}
