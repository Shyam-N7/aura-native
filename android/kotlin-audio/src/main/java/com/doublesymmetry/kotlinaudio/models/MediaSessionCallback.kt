package com.doublesymmetry.kotlinaudio.models

import android.os.Bundle
import android.support.v4.media.RatingCompat

sealed class MediaSessionCallback {
    class RATING(val rating: RatingCompat, extras: Bundle?): MediaSessionCallback()
    // AURA fork extension: an app-defined media session action (the
    // notification heart), identified by its action string.
    class CUSTOM(val action: String): MediaSessionCallback()
    object PLAY : MediaSessionCallback()
    object PAUSE : MediaSessionCallback()
    object NEXT : MediaSessionCallback()
    object PREVIOUS : MediaSessionCallback()
    object FORWARD : MediaSessionCallback()
    object REWIND : MediaSessionCallback()
    object STOP : MediaSessionCallback()
    class SEEK(val positionMs: Long): MediaSessionCallback()
}
