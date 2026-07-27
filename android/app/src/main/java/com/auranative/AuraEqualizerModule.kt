package com.auranative

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.audiofx.BassBoost
import android.media.audiofx.DynamicsProcessing
import android.media.audiofx.LoudnessEnhancer
import android.os.Build
import android.media.audiofx.Equalizer
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * The equalizer's native half — Android's own audio effects, attached to the
 * ExoPlayer audio session that react-native-track-player is already driving.
 *
 * Why the platform effects rather than our own DSP: they run in the audio
 * server (usually on the DSP itself), so they cost no per-sample CPU and — the
 * part that matters here — they sit OUTSIDE our playback pipeline, the one
 * hardened for screen-off playback on this ROM. The price is that the DEVICE
 * decides how many bands there are and where they sit; describe() reports what
 * this phone actually offers and the UI is built from that, never from a
 * guess.
 *
 * Two rules this module never breaks:
 *  - Never attach to session 0. That is the global output mix: it would
 *    process every other app's audio, and modern Android restricts it anyway.
 *    No real session id means no equalizer, and we say so.
 *  - One live effect set at a time, always released before re-attaching.
 *    AudioEffect holds native resources, and leaking those on a device that
 *    OOM-kills the biggest resident app is exactly the failure this project
 *    keeps fighting.
 */
class AuraEqualizerModule(private val reactCtx: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactCtx) {

  override fun getName() = NAME

  private val main = Handler(Looper.getMainLooper())
  private var equalizer: Equalizer? = null
  private var bassBoost: BassBoost? = null
  // Volume boost (docs/perf/04 4b): gain INTO a limiter, never bare gain.
  // API 28+ gets DynamicsProcessing (real limiter stage); 26-27 fall back to
  // LoudnessEnhancer, which JS caps at +6 dB — OEM behavior above that clips.
  private var boostDp: DynamicsProcessing? = null
  private var boostLe: LoudnessEnhancer? = null
  private var sessionId = 0
  private var routeWatching = false

  private val boostMode: String
    get() = if (Build.VERSION.SDK_INT >= 28) "limiter" else "plain"

  private val audio: AudioManager?
    get() = reactCtx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  // ── describe ────────────────────────────────────────────────────────────
  // The probe the whole feature rests on: does this ROM grant an Equalizer at
  // all (OEM sound stacks sometimes refuse), and if so, what bands? Built on a
  // throwaway effect so describing costs nothing and leaves nothing attached.
  @ReactMethod
  fun describe(promise: Promise) {
    var probe: Equalizer? = null
    try {
      // Session 0 is legal for a DESCRIBE-only probe (we attach nothing and
      // release immediately); it is never used to actually process audio.
      probe = Equalizer(0, 0)
      val bands = Arguments.createArray()
      val range = probe.bandLevelRange // [min, max] in millibels
      val minMb = range[0].toInt()
      val maxMb = range[1].toInt()
      for (i in 0 until probe.numberOfBands.toInt()) {
        val band = Arguments.createMap()
        band.putInt("index", i)
        // centerFreq is milliHertz — hand JS plain Hz.
        band.putInt("centerHz", probe.getCenterFreq(i.toShort()) / 1000)
        band.putInt("minMb", minMb)
        band.putInt("maxMb", maxMb)
        bands.pushMap(band)
      }
      val out = Arguments.createMap()
      out.putBoolean("available", true)
      out.putArray("bands", bands)
      out.putString("output", detectOutput())
      // "limiter" = DynamicsProcessing (safe to +12 dB), "plain" =
      // LoudnessEnhancer (JS caps at +6 dB). Availability is only truly known
      // at attach; this names the CLASS of booster the UI may offer.
      out.putString("boost", boostMode)
      promise.resolve(out)
    } catch (e: Throwable) {
      // Refused (OEM DSP, policy, missing permission) — report it honestly so
      // the screen can say why instead of showing dead faders.
      val out = Arguments.createMap()
      out.putBoolean("available", false)
      out.putString("reason", e.message ?: e.javaClass.simpleName)
      out.putArray("bands", Arguments.createArray())
      out.putString("output", detectOutput())
      promise.resolve(out)
    } finally {
      try {
        probe?.release()
      } catch (_: Throwable) {
      }
    }
  }

  // ── attach / release ────────────────────────────────────────────────────
  @ReactMethod
  fun attach(session: Int, promise: Promise) {
    if (session == 0) {
      // No real player session yet — stay off rather than touch the global mix.
      promise.resolve(false)
      return
    }
    main.post {
      try {
        releaseEffects()
        sessionId = session
        equalizer = Equalizer(EFFECT_PRIORITY, session)
        bassBoost = try {
          BassBoost(EFFECT_PRIORITY, session)
        } catch (_: Throwable) {
          null // optional extra — its absence never blocks the equalizer
        }
        attachBooster(session)
        promise.resolve(true)
      } catch (e: Throwable) {
        releaseEffects()
        promise.reject("attach_failed", e.message ?: "could not attach", e)
      }
    }
  }

  @ReactMethod
  fun release(promise: Promise?) {
    main.post {
      releaseEffects()
      promise?.resolve(null)
    }
  }

  // Gain into a limiter (never bare gain). All-channel limiter: attack 1ms,
  // release 60ms, ratio 10:1, threshold −1 dBFS — boosted peaks compress
  // instead of hard-clipping (docs/perf/04 4b). Failure leaves boost null:
  // optional, never blocks the equalizer.
  private fun attachBooster(session: Int) {
    if (Build.VERSION.SDK_INT >= 28) {
      boostDp = try {
        val cfg = DynamicsProcessing.Config.Builder(
          DynamicsProcessing.VARIANT_FAVOR_TIME_RESOLUTION,
          2, // stereo
          false, 0, // no pre-EQ stage
          false, 0, // no multi-band compressor stage
          false, 0, // no post-EQ stage
          true, // limiter stage
        ).build()
        val dp = DynamicsProcessing(EFFECT_PRIORITY, session, cfg)
        dp.setLimiterAllChannelsTo(
          DynamicsProcessing.Limiter(true, true, 0, 1f, 60f, 10f, -1f, 0f),
        )
        dp
      } catch (_: Throwable) {
        null
      }
    }
    if (boostDp == null) {
      boostLe = try {
        LoudnessEnhancer(session)
      } catch (_: Throwable) {
        null
      }
    }
  }

  private fun releaseEffects() {
    try {
      equalizer?.enabled = false
      equalizer?.release()
    } catch (_: Throwable) {
    }
    try {
      bassBoost?.enabled = false
      bassBoost?.release()
    } catch (_: Throwable) {
    }
    try {
      boostDp?.enabled = false
      boostDp?.release()
    } catch (_: Throwable) {
    }
    try {
      boostLe?.enabled = false
      boostLe?.release()
    } catch (_: Throwable) {
    }
    equalizer = null
    bassBoost = null
    boostDp = null
    boostLe = null
    sessionId = 0
  }

  // ── controls ────────────────────────────────────────────────────────────
  @ReactMethod
  fun setEnabled(on: Boolean, promise: Promise) {
    main.post {
      try {
        equalizer?.enabled = on
        // Bass boost rides the same switch; a zero strength is a no-op anyway.
        bassBoost?.enabled = on && (bassBoost?.roundedStrength ?: 0) > 0
        promise.resolve(true)
      } catch (e: Throwable) {
        promise.reject("enable_failed", e.message ?: "could not enable", e)
      }
    }
  }

  @ReactMethod
  fun setBandLevel(index: Int, millibels: Int, promise: Promise) {
    main.post {
      try {
        val eq = equalizer
        if (eq == null) {
          promise.resolve(false)
          return@post
        }
        val range = eq.bandLevelRange
        val clamped = millibels.coerceIn(range[0].toInt(), range[1].toInt())
        eq.setBandLevel(index.toShort(), clamped.toShort())
        promise.resolve(true)
      } catch (e: Throwable) {
        promise.reject("band_failed", e.message ?: "could not set band", e)
      }
    }
  }

  @ReactMethod
  fun setBassBoost(strength: Int, promise: Promise) {
    main.post {
      try {
        val bb = bassBoost
        if (bb == null) {
          promise.resolve(false)
          return@post
        }
        val s = strength.coerceIn(0, 1000)
        bb.setStrength(s.toShort())
        bb.enabled = s > 0 && equalizer?.enabled == true
        promise.resolve(true)
      } catch (e: Throwable) {
        promise.reject("bass_failed", e.message ?: "could not set bass boost", e)
      }
    }
  }

  // Volume boost in millibels (0..1200). The DynamicsProcessing path feeds
  // input gain into the limiter configured at attach; the LoudnessEnhancer
  // fallback applies target gain directly — JS never sends it more than 600.
  @ReactMethod
  fun setBoost(millibels: Int, promise: Promise) {
    main.post {
      try {
        val mb = millibels.coerceIn(0, 1200)
        val dp = boostDp
        val le = boostLe
        when {
          dp != null -> {
            dp.setInputGainAllChannelsTo(mb / 100f)
            dp.enabled = mb > 0
          }
          le != null -> {
            le.setTargetGain(mb.coerceAtMost(600))
            le.enabled = mb > 0
          }
          else -> {
            promise.resolve(false)
            return@post
          }
        }
        promise.resolve(true)
      } catch (e: Throwable) {
        promise.reject("boost_failed", e.message ?: "could not set boost", e)
      }
    }
  }

  // ── output route ────────────────────────────────────────────────────────
  // What media audio is ACTUALLY routed to — not merely what's plugged in.
  // API 31+ answers that directly; older devices get a priority reduction over
  // the connected outputs, which is the best the platform allows.
  private fun detectOutput(): String {
    val am = audio ?: return SPEAKER
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val attrs = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
          .build()
        val routed = am.getAudioDevicesForAttributes(attrs)
        val first = routed.firstOrNull()
        if (first != null) return classify(first.type)
      }
      val outs = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
      // Priority mirrors Android's own routing preference.
      val ranked = outs.map { classify(it.type) }
      return when {
        ranked.contains(BLUETOOTH) -> BLUETOOTH
        ranked.contains(WIRED) -> WIRED
        else -> SPEAKER
      }
    } catch (_: Throwable) {
      return SPEAKER
    }
  }

  private fun classify(type: Int): String = when (type) {
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
    AudioDeviceInfo.TYPE_BLE_HEADSET,
    AudioDeviceInfo.TYPE_BLE_SPEAKER,
    -> BLUETOOTH
    AudioDeviceInfo.TYPE_WIRED_HEADSET,
    AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
    AudioDeviceInfo.TYPE_USB_HEADSET,
    AudioDeviceInfo.TYPE_USB_DEVICE,
    -> WIRED
    else -> SPEAKER
  }

  @ReactMethod
  fun currentOutput(promise: Promise) {
    promise.resolve(detectOutput())
  }

  // Route changes arrive from two directions: devices appearing/disappearing,
  // and the "becoming noisy" broadcast the system sends the instant headphones
  // are pulled. Both re-read the ACTUAL route and tell JS.
  private val deviceCallback = object : AudioDeviceCallback() {
    override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>?) = emitRoute()
    override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>?) = emitRoute()
  }

  private val noisyReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) = emitRoute()
  }

  private fun emitRoute() {
    // The route settles a beat after the event fires.
    main.postDelayed({
      val payload: WritableMap = Arguments.createMap()
      payload.putString("output", detectOutput())
      try {
        reactCtx
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(EVENT_ROUTE, payload)
      } catch (_: Throwable) {
      }
    }, 250)
  }

  @ReactMethod
  fun startRouteWatch(promise: Promise) {
    if (routeWatching) {
      promise.resolve(true)
      return
    }
    try {
      audio?.registerAudioDeviceCallback(deviceCallback, main)
      reactCtx.registerReceiver(
        noisyReceiver,
        IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
      )
      routeWatching = true
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("route_watch_failed", e.message ?: "could not watch route", e)
    }
  }

  @ReactMethod
  fun stopRouteWatch(promise: Promise?) {
    stopWatchingRoute()
    promise?.resolve(null)
  }

  private fun stopWatchingRoute() {
    if (!routeWatching) return
    try {
      audio?.unregisterAudioDeviceCallback(deviceCallback)
    } catch (_: Throwable) {
    }
    try {
      reactCtx.unregisterReceiver(noisyReceiver)
    } catch (_: Throwable) {
    }
    routeWatching = false
  }

  // RCTDeviceEventEmitter bookkeeping — required or RN warns on every emit.
  @ReactMethod fun addListener(eventName: String?) = Unit

  @ReactMethod fun removeListeners(count: Int) = Unit

  override fun invalidate() {
    // The host is going away: let go of the native effect resources and the
    // receivers rather than leaving them to be reaped.
    stopWatchingRoute()
    main.post { releaseEffects() }
    super.invalidate()
  }

  companion object {
    const val NAME = "AuraEqualizer"
    const val EVENT_ROUTE = "aura-audio-route"
    // Politely low: a system/OEM effect on the same session should win.
    private const val EFFECT_PRIORITY = 0
    private const val SPEAKER = "speaker"
    private const val WIRED = "wired"
    private const val BLUETOOTH = "bluetooth"
  }
}
