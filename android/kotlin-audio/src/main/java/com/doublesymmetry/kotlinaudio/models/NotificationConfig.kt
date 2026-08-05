package com.doublesymmetry.kotlinaudio.models

import android.app.PendingIntent
import androidx.annotation.DrawableRes

/**
 * Used to configure the player notification.
 * @param buttons Provide customized notification buttons. They will be shown by default. Note that buttons can still be shown and hidden at runtime by using the functions in [NotificationManager][com.doublesymmetry.kotlinaudio.notification.NotificationManager], but they will have the default icon if not set explicitly here.
 * @param accentColor The accent color of the notification.
 * @param smallIcon The small icon of the notification which is also shown in the system status bar.
 * @param pendingIntent The [PendingIntent] that would be called when tapping on the notification itself.
 */
data class NotificationConfig(
    val buttons: List<NotificationButton>,
    val accentColor: Int? = null,
    @DrawableRes val smallIcon: Int? = null,
    val pendingIntent: PendingIntent? = null
)

/**
 * Provide customized notification buttons. They will be shown by default. Note that buttons can still be shown and hidden at runtime by using the functions in [NotificationManager][com.doublesymmetry.kotlinaudio.notification.NotificationManager], but they will have the default icon if not set explicitly here.
 * @see [com.doublesymmetry.kotlinaudio.notification.NotificationManager.showPlayPauseButton]
 * @see [com.doublesymmetry.kotlinaudio.notification.NotificationManager.showStopButton]
 * @see [com.doublesymmetry.kotlinaudio.notification.NotificationManager.showRewindButton]
 * @see [com.doublesymmetry.kotlinaudio.notification.NotificationManager.showRewindButtonCompact]
 * @see [com.doublesymmetry.kotlinaudio.notification.NotificationManager.showForwardButton]
 * @see [com.doublesymmetry.kotlinaudio.notification.NotificationManager.showForwardButtonCompact]
 * @see [com.doublesymmetry.kotlinaudio.notification.NotificationManager.showNextButton]
 * @see [com.doublesymmetry.kotlinaudio.notification.NotificationManager.showNextButtonCompact]
 * @see [com.doublesymmetry.kotlinaudio.notification.NotificationManager.showPreviousButton]
 * @see [com.doublesymmetry.kotlinaudio.notification.NotificationManager.showPreviousButtonCompact]
 */
@Suppress("ClassName")
sealed class NotificationButton {
    // AURA fork extension: an app-defined button carried BOTH as a media
    // session custom action (what stock Android 13+ renders) AND as a classic
    // notification action (what several OEM media cards — this device's
    // ColorOS included — still read). Identity is the action string.
    //
    // `altIcon` is the OTHER icon this button can wear (the heart's opposite
    // state). PlayerNotificationManager caches its notification actions at
    // construction, so swapping `icon` alone can never repaint the classic
    // row — and rebuilding the manager to force it tears down a live
    // foreground-service notification, which a heart tap must not do.
    // Registering BOTH icons up front instead lets getCustomActions() select
    // the key whose icon matches the current state, with no rebuild at all.
    // Leave it null for a button whose icon never changes.
    class CUSTOM(
        val action: String,
        @DrawableRes val icon: Int,
        val title: String = action,
        @DrawableRes val altIcon: Int? = null,
    ): NotificationButton()
    class PLAY_PAUSE(@DrawableRes val playIcon: Int? = null, @DrawableRes val pauseIcon: Int? = null): NotificationButton()
    class STOP(@DrawableRes val icon: Int? = null): NotificationButton()
    class FORWARD(@DrawableRes val icon: Int? = null, val isCompact: Boolean = false): NotificationButton()
    class BACKWARD(@DrawableRes val icon: Int? = null, val isCompact: Boolean = false): NotificationButton()
    class NEXT(@DrawableRes val icon: Int? = null, val isCompact: Boolean = false): NotificationButton()
    class PREVIOUS(@DrawableRes val icon: Int? = null, val isCompact: Boolean = false): NotificationButton()
    object SEEK_TO : NotificationButton()
}