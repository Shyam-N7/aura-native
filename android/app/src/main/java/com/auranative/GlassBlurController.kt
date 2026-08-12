// Same package as the library: BlurView.blurController is package-private,
// and this controller reuses BlurViewCanvas/SizeScaler. One APK, one
// classloader — the runtime package check passes.
package eightbitlab.com.blurview

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Rect
import android.graphics.drawable.Drawable
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver

/**
 * PreDrawBlurController with a crash shield. The stock controller force-draws
 * the whole hierarchy every frame from onPreDraw; react-native-screens'
 * ScreenStack runs custom draw-op bookkeeping in dispatchDraw, and when the
 * two interleave mid-mutation the walk dies with IndexOutOfBounds in
 * ViewGroup.getAndVerifyPreorderedView (three field crashes with identical
 * stacks through PreDrawBlurController.updateBlur — scrolls and pops alike,
 * survived the screens 4.25.2 bump).
 *
 * Two changes, both in updateBlur:
 * - the hierarchy draw is wrapped: a throw skips the frame instead of
 *   killing the app;
 * - the snapshot lands in a STAGING bitmap first and is promoted only on
 *   success, so a half-drawn frame can never reach the visible blur (the
 *   render node references the bitmap's pixels live — blurring or showing a
 *   torn snapshot would flash). The bitmaps are downscaled (~1/6), so the
 *   extra copy is a few KB per frame.
 *
 * Everything else is a faithful port of PreDrawBlurController 2.0.6.
 */
class GlassBlurController(
  private val blurView: View,
  private val rootView: ViewGroup,
  private var overlayColor: Int,
  private val blurAlgorithm: BlurAlgorithm,
  saturation: Float,
) : BlurController {

  private var blurRadius = BlurController.DEFAULT_BLUR_RADIUS

  private lateinit var internalCanvas: BlurViewCanvas
  private lateinit var internalBitmap: Bitmap
  private lateinit var stagingCanvas: BlurViewCanvas
  private lateinit var stagingBitmap: Bitmap

  private val rootLocation = IntArray(2)
  private val blurViewLocation = IntArray(2)
  private val visibleRect = Rect()

  // Full-replace composite for promoting staging → internal (SRC ignores
  // whatever the last blur left in the destination). The color filter is the
  // web glass saturate(180%): a paint filters SOURCE pixels before the
  // xfermode composites them, so the saturation rides the copy we already
  // pay for — saturation is a linear per-pixel transform, so pre-blur
  // placement is visually identical to CSS's after-blur order. (This
  // replaced GlassSaturatingBlur's per-capture saveLayer, which allocated a
  // fresh offscreen layer and two more full-bitmap passes every frame.)
  private val promotePaint = Paint().apply {
    xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC)
    colorFilter = ColorMatrixColorFilter(
      ColorMatrix().apply { setSaturation(saturation) },
    )
  }

  private val drawListener = ViewTreeObserver.OnPreDrawListener {
    // Not invalidating a View here, just updating the Bitmap.
    updateBlur()
    true
  }

  private var blurEnabled = true
  private var initialized = false
  private var frameClearDrawable: Drawable? = null
  private var clearColor: Int? = null

  // Self-heal state. The controller must not be able to STAY wedged, no
  // matter which path wedged it: repeated caught failures force a re-init,
  // and the immortal heartbeat below restores everything else.
  //
  // desiredAutoUpdate is the JS intent (the frozen prop), set ONLY through
  // setDesired(). It is deliberately SEPARATE from the armed state:
  // BlurView's own lifecycle calls setBlurAutoUpdate directly — detach
  // disarms unconditionally, but attach re-arms ONLY when a transient
  // isHardwareAccelerated() read says true (bytecode-verified), so around
  // react-native-screens fragment re-parenting the armed state is
  // STRANDABLE. The old design gated the heartbeat on the same flag that
  // stranded — the watchdog died with its patient (owner-visible as the
  // transparent top bar after a Liked round-trip, 2026-08-02).
  private var desiredAutoUpdate = true
  private var dead = false
  private var consecutiveFailures = 0
  private var consecutiveBlurFailures = 0
  private var lastSuccessUptime = 0L
  private var lastCaptureUptime = 0L

  // When the platform last actually PAINTED us. DIAGNOSTIC ONLY — never a
  // health trigger. The blur render node references the snapshot bitmap's
  // pixels live, so a refreshed capture reaches the screen without any draw()
  // call; a bar over static content can go seconds without painting and be
  // completely healthy. What it is good for is telling "never asked to draw"
  // apart from "asked, but drew nothing" when reading a trace.
  private var lastDrawUptime = 0L
  private var lastPaintLogUptime = 0L
  private var lastReviveUptime = 0L

  // The last value handed to setBlurAutoUpdate. The library writes that method
  // directly on attach/detach, so this is the only way to know from a log
  // whether the preDraw listener is actually registered right now — the single
  // most useful fact that was missing when diagnosing the transparent bar.
  private var armed = false

  // When desiredAutoUpdate last went false, for the leaked-hold warning.
  private var desiredFalseSince = 0L

  // Immortal: posted at construction, always re-posts, only destroy() stops
  // it. A no-op tick every 2s is free; what it buys is that NO interleaving
  // of library lifecycle, rns re-parenting, or freeze-timer ordering can
  // permanently silence captures — any stranded state heals in ≤2s while a
  // legitimate freeze (desired=false) stays frozen.
  /**
   * Does this view have real geometry to capture into?
   *
   * Deliberately NOT `isLaidOut`. That flag is `PFLAG3_IS_LAID_OUT`, and
   * `onDetachedFromWindowInternal()` clears it — react-native-screens detaches
   * the ENTIRE tab subtree on a native-stack push, and the top bar lives inside
   * the tab navigator. It never comes back: RN's `ReactViewGroup.onLayout` is a
   * no-op and terminates `requestLayout()`, so the only thing that calls
   * `layout()` on an RN view is Fabric's `updateLayout` mutation — emitted only
   * when a node's computed metrics CHANGE. The bar is a fixed height at a fixed
   * margin, so a pop restores identical metrics, no mutation is sent, and
   * `isLaidOut` stays false for the rest of the process.
   *
   * Every self-heal in this file used to sit behind that one dead flag — the
   * capture guard, the revive branch, the stale-snapshot branch — so the view
   * ended up alive, armed, ticking, and capturing nothing. That is the
   * transparent top bar after a Liked/Playlist round-trip, and it is why
   * resetting `initialized` alone did not fix it: the branch that reset
   * enables is gated on the same check.
   *
   * Measured size plus the geometric visible-rect test is the honest signal —
   * the same reasoning this file already applied when it chose
   * `getGlobalVisibleRect` over `isShown`.
   *
   * Both pairs are checked on purpose. The capture matrix is built from
   * `width`/`height`, but `init()` allocates from `measuredWidth`/
   * `measuredHeight`; if only one pair were tested and the two disagreed, the
   * revive branch would fire on every heartbeat while `init()` kept bailing on
   * a zero measure — a 0.5Hz log loop that never heals.
   */
  private fun hasUsableSize(): Boolean =
    blurView.width > 0 &&
      blurView.height > 0 &&
      blurView.measuredWidth > 0 &&
      blurView.measuredHeight > 0

  /**
   * One-line dump of everything that decides whether this view paints.
   *
   * Every field here was needed at least once to tell the wedges apart, and
   * none of them was observable before. Edge-triggered only — attach/detach,
   * a heartbeat branch, a re-init — never per frame.
   */
  private fun state(): String {
    val now = SystemClock.uptimeMillis()
    return "[init=$initialized desired=$desiredAutoUpdate armed=$armed " +
      "enabled=$blurEnabled dead=$dead willNotDraw=${blurView.willNotDraw()} " +
      "w=${blurView.width} h=${blurView.height} " +
      "mw=${blurView.measuredWidth} mh=${blurView.measuredHeight} " +
      "bmp=${if (initialized) "${internalBitmap.width}x${internalBitmap.height}" else "none"} " +
      "rect=${blurView.getGlobalVisibleRect(visibleRect)}$visibleRect " +
      "focus=${blurView.hasWindowFocus()} attached=${blurView.isAttachedToWindow} " +
      "sinceCapture=${now - lastSuccessUptime} sinceDraw=${now - lastDrawUptime}]"
  }

  private val heartbeat = object : Runnable {
    override fun run() {
      if (dead) {
        return
      }
      if (desiredAutoUpdate) {
        // A HEAL MUST NOT BE GATED ON THE SYMPTOM.
        //
        // Both branches below used to require hasUsableSize(), which is one of
        // the very things that goes wrong — so the states that most needed
        // healing were exactly the ones the watchdog refused to touch. Two
        // survived every fix: a controller whose width/height read 0 while its
        // MEASURED pair does not (init() succeeds off the measured pair, so it
        // looks initialized, but the capture guard and draw()'s scale both
        // collapse), and a controller capturing happily into a bitmap nothing
        // ever paints. Attachment is the only precondition a heal needs;
        // init() and updateBlur() already bail safely on their own.
        //
        // The two checks are also independent now. As an else-if, an
        // initialized controller could never reach the re-init path, which is
        // the only thing that re-reads geometry.
        val attached = blurView.isAttachedToWindow
        val nowMs = SystemClock.uptimeMillis()
        if (
          attached &&
          !initialized &&
          // Retry AT ONCE when the size looks usable — that is the healing
          // case. When it does not, still retry, just slowly: a size test can
          // gate the CADENCE but must never gate the attempt away entirely,
          // which is precisely what left these states stranded. init() is
          // cheap and judges the geometry itself; the backoff only exists so a
          // legitimately 0x0 view cannot churn the preDraw listener and flood
          // logcat at 0.5Hz forever.
          (hasUsableSize() || nowMs - lastReviveUptime > REVIVE_RETRY_MS)
        ) {
          lastReviveUptime = nowMs
          // init() during a transient zero-size layout leaves
          // initialized=false with nothing scheduled to retry —
          // onSizeChanged may never fire again (the size returns to its
          // old value), and draw() contributes nothing (the transparent
          // pill). Re-init and let init() judge the size itself.
          Log.w(TAG, "heartbeat: reviving uninitialized controller ${state()}")
          updateBlurViewSize()
          blurView.invalidate()
        }
        // Staleness is measured on CAPTURES, not paints.
        //
        // Draw time looks like the better signal — it is what the user
        // actually sees — but it is not one. `blurAlgorithm.render` hands the
        // render node the bitmap's pixels LIVE, so refreshing the snapshot
        // updates the screen with no draw() call at all; a bar over static
        // content can legitimately go many seconds without painting. A first
        // pass here took the older of the two stamps, which made every healthy
        // idle bar look wedged and turned this branch into a 0.5Hz loop that
        // forced a whole-tree software capture every 2s on a view that was
        // fine — visible in the field trace as sinceCapture=1ms next to
        // sinceDraw=2002ms, over and over.
        //
        // lastDrawUptime is kept: it is genuinely useful in the state dump,
        // just not as a trigger.
        val quietSince = SystemClock.uptimeMillis() - lastSuccessUptime
        if (
          attached &&
          initialized &&
          // Screen off / behind another window: no one can see the glass —
          // don't burn snapshot work while parked.
          blurView.hasWindowFocus() &&
          blurView.getGlobalVisibleRect(visibleRect) &&
          quietSince > HEARTBEAT_MS
        ) {
          // Re-read geometry FIRST: on the wedges above, re-arming and forcing
          // a capture accomplish nothing until init() has run again. It is
          // cheap — init() keeps its buffers when the scaled size is unchanged.
          Log.w(TAG, "heartbeat: quiet ${quietSince}ms, re-initing ${state()}")
          updateBlurViewSize()
          setBlurAutoUpdate(true)
          updateBlur(force = true)
          blurView.invalidate()
        }
      } else if (
        // Frozen is a legitimate state with no native recovery: the heartbeat
        // is gated on intent, so a hold that is never released (lib/navFreeze
        // keys them, and a screen that unmounts without releasing its own
        // leaves one behind) pins the glass off for the rest of the process,
        // silently. Nothing can heal that from here — but it should not be
        // invisible.
        blurView.isAttachedToWindow &&
        blurView.hasWindowFocus() &&
        blurView.getGlobalVisibleRect(visibleRect) &&
        SystemClock.uptimeMillis() - desiredFalseSince > FROZEN_WARN_MS
      ) {
        desiredFalseSince = SystemClock.uptimeMillis() // re-arm the warning
        Log.w(TAG, "heartbeat: visible but frozen for >${FROZEN_WARN_MS}ms — leaked hold? ${state()}")
      }
      blurView.postDelayed(this, HEARTBEAT_MS)
    }
  }

  init {
    if (blurAlgorithm is RenderEffectBlur) {
      blurAlgorithm.setContext(blurView.context)
    }
    init(blurView.measuredWidth, blurView.measuredHeight)
    // On a detached view this parks in the run queue and starts on attach.
    blurView.postDelayed(heartbeat, HEARTBEAT_MS)
  }

  private fun init(measuredWidth: Int, measuredHeight: Int) {
    // Respect the JS intent — a resize during a freeze window must not
    // silently re-enable captures (the stock controller forces true here).
    setBlurAutoUpdate(desiredAutoUpdate)
    val sizeScaler = SizeScaler(blurAlgorithm.scaleFactor())
    if (sizeScaler.isZeroSized(measuredWidth, measuredHeight)) {
      // Will be initialized later when the View reports a size change — or,
      // if that never comes, by the heartbeat's revive branch.
      //
      // That branch is gated on !initialized, so a controller that had ALREADY
      // initialized once must be knocked back down here. Leaving the flag true
      // strands it: WILL_NOT_DRAW is set, draw() contributes nothing, and every
      // route back is closed — onSizeChanged doesn't fire when the size returns
      // to its previous value (the case this comment's first line assumes), the
      // revive branch is skipped because initialized is true, and the stale-
      // snapshot branch only re-arms captures and invalidates, none of which
      // clears WILL_NOT_DRAW. It refreshes bitmaps forever into a view that
      // never draws them. Owner-visible as the transparent top bar after a
      // detail-screen round-trip — the same symptom as the armed-state
      // stranding above, reached by a second, independent path.
      initialized = false
      blurView.setWillNotDraw(true)
      return
    }

    blurView.setWillNotDraw(false)
    val bitmapSize = sizeScaler.scale(measuredWidth, measuredHeight)

    // Already running at exactly this bitmap size: keep the buffers.
    //
    // BlurView routes EVERY size change through here, and the dock's
    // back-to-top morph animates a LAYOUT width, so this ran once per frame of
    // the morph — two Bitmap.createBitmap plus two BlurViewCanvas allocations,
    // thrown away on the next frame. At ~1/6 scale a great many of those frames
    // round to an identical bitmap size, so the allocation bought nothing at
    // all. Captures are already throttled; the allocations were not.
    if (
      initialized &&
      internalBitmap.width == bitmapSize.width &&
      internalBitmap.height == bitmapSize.height
    ) {
      // The view's own dimensions may still have moved under the same scaled
      // size — the capture matrix is recomputed per frame from them, so a
      // refresh is all this needs.
      updateBlur()
      return
    }

    val config = blurAlgorithm.supportedBitmapConfig
    internalBitmap = Bitmap.createBitmap(bitmapSize.width, bitmapSize.height, config)
    internalCanvas = BlurViewCanvas(internalBitmap)
    stagingBitmap = Bitmap.createBitmap(bitmapSize.width, bitmapSize.height, config)
    stagingCanvas = BlurViewCanvas(stagingBitmap)
    initialized = true
    updateBlur()
  }

  private fun updateBlur(force: Boolean = false) {
    if (!blurEnabled || !initialized) {
      return
    }
    // ~30Hz capture cap. preDraw fires for EVERY window frame, and each
    // capture software-draws the whole tree per glass view — at 60-120Hz
    // display rates that cost starves the UI thread (field lag on two
    // devices). Under blur(40)+saturate at 1/6 scale a half-rate backdrop is
    // imperceptible; skipped frames keep the last blur and cost nothing
    // downstream (no re-record → no damage). 30ms not 33: locks cleanly to
    // every 2nd frame at 60Hz / 4th at 120Hz instead of beating against the
    // frame clock. A skip is neither success nor failure — the self-heal
    // counters stay untouched. The heartbeat forces past it.
    val now = SystemClock.uptimeMillis()
    if (!force && now - lastCaptureUptime < CAPTURE_MIN_INTERVAL_MS) {
      return
    }
    // Hidden instances (each tab mounts its own top bar; inactive tabs are
    // hidden) report garbage coordinates — the snapshot lands on the dark
    // window background and the bar arrives BLACK on tab switch (owner
    // report). Geometric test, NOT isShown: react-native-screens containers
    // report visibility flags that read hidden for on-screen content, which
    // silenced captures entirely (the bar went fully transparent — owner
    // caught it live). An empty global visible rect is the honest signal.
    //
    // Nor isLaidOut, for the same class of reason and a worse consequence —
    // see hasUsableSize(): a stack push clears that flag permanently, which
    // silenced this guard for the whole rest of the process.
    if (!hasUsableSize() || !blurView.getGlobalVisibleRect(visibleRect)) {
      return
    }
    // Stamped only when a capture is genuinely attempted, so guard-skipped
    // frames never delay the first capture after the view returns.
    lastCaptureUptime = now

    // Theme-colored clear coat when JS provided one: the decorView background
    // is DARK on many devices, so any capture that under-paints reads as a
    // black shade on the pill (field report, Android 15) — with the app's own
    // background the same failure is invisible. eraseColor is also a memset
    // vs a (possibly layered) drawable draw.
    val cc = clearColor
    if (cc != null) {
      stagingBitmap.eraseColor(cc)
    } else {
      val clear = frameClearDrawable
      if (clear == null) {
        stagingBitmap.eraseColor(Color.TRANSPARENT)
      } else {
        clear.draw(stagingCanvas)
      }
    }

    // A mid-mutation child can UNBALANCE the canvas either way: eat our save
    // (plain restore() then threw Underflow OUTSIDE the shield — field fatal
    // 2026-08-02 01:47) or leave extra saves, silently drifting the matrix so
    // every later capture painted off-bitmap and the pill promoted pure clear
    // coat while counting as success (the owner's flat top bar). Bracketing
    // with restoreToCount self-cleans drift every frame; the restore itself
    // is shielded so the cleanup can never become the crash.
    val base = stagingCanvas.saveCount
    stagingCanvas.save()
    setupInternalCanvasMatrix()
    val ok = try {
      rootView.draw(stagingCanvas)
      true
    } catch (e: RuntimeException) {
      // Mid-mutation hierarchy (ScreenStack draw ops) — skip this frame,
      // the last good blur stays on screen and next preDraw retries.
      Log.w(TAG, "snapshot skipped: ${e.javaClass.simpleName}")
      false
    } finally {
      try {
        stagingCanvas.restoreToCount(base)
      } catch (e: IllegalStateException) {
        Log.w(TAG, "restore skipped: canvas unbalanced by hierarchy draw")
      }
    }
    if (!ok) {
      consecutiveFailures++
      if (consecutiveFailures >= REINIT_AFTER_FAILURES) {
        // Something is persistently wrong with this controller's state — go
        // back through init() outside this pass, so the geometry is re-read
        // and a capture is retried off the throttle.
        //
        // It does NOT rebuild anything, despite how this used to read: a
        // snapshot failure does not change the view's measured size, so
        // init() takes its "keep the buffers" early return every time and
        // only calls updateBlur(). No fresh bitmaps, no fresh listeners.
        // Re-reading geometry is the whole benefit, and for the wedges this
        // counter was written against that is in fact the useful part.
        consecutiveFailures = 0
        blurView.post { updateBlurViewSize() }
      }
      return
    }
    consecutiveFailures = 0
    lastSuccessUptime = SystemClock.uptimeMillis()

    internalCanvas.drawBitmap(stagingBitmap, 0f, 0f, promotePaint)
    blurAndSave()
  }

  // Set up matrix to draw starting from blurView's position (port of
  // upstream, staging canvas instead).
  private fun setupInternalCanvasMatrix() {
    rootView.getLocationOnScreen(rootLocation)
    blurView.getLocationOnScreen(blurViewLocation)

    val left = blurViewLocation[0] - rootLocation[0]
    val top = blurViewLocation[1] - rootLocation[1]

    val scaleFactorH = blurView.height.toFloat() / stagingBitmap.height
    val scaleFactorW = blurView.width.toFloat() / stagingBitmap.width

    stagingCanvas.translate(-left / scaleFactorW, -top / scaleFactorH)
    stagingCanvas.scale(1 / scaleFactorW, 1 / scaleFactorH)
  }

  override fun draw(canvas: Canvas): Boolean {
    if (!blurEnabled || !initialized) {
      return true
    }
    // Not blurring itself or other BlurViews to not cause recursive draws.
    if (canvas is BlurViewCanvas) {
      return false
    }

    // Reached the screen. Stamped BEFORE the scale is computed so a zero-scale
    // paint still counts as "the platform called us" — the heartbeat needs to
    // distinguish "never asked to draw" from "asked, but drew nothing", and
    // only the first is a lifecycle wedge.
    val drawAt = SystemClock.uptimeMillis()
    val paintGap = drawAt - lastDrawUptime
    lastDrawUptime = drawAt

    val scaleFactorH = blurView.height.toFloat() / internalBitmap.height
    val scaleFactorW = blurView.width.toFloat() / internalBitmap.width

    // Painting again after a visible gap, or painting at a degenerate scale,
    // are the two things worth a line here — a run of ordinary frames is not.
    // scale=0 is the direct signature of the width/height-vs-measured split.
    //
    // Rate-limited on its own clock, not just the gap: a wedged view paints at
    // scale 0 on EVERY frame, and logging that per frame would bury the very
    // trace it exists to produce.
    val degenerate = scaleFactorW <= 0f || scaleFactorH <= 0f
    if (
      (paintGap > PAINT_LOG_GAP_MS || degenerate) &&
      drawAt - lastPaintLogUptime > PAINT_LOG_GAP_MS
    ) {
      lastPaintLogUptime = drawAt
      Log.i(TAG, "paint gap=${paintGap}ms scale=${scaleFactorW}x$scaleFactorH ${state()}")
    }

    // Shielded, and bracketed with restoreToCount rather than restore(), for
    // the same reason the capture pass is: a throw here must not leave the
    // caller's canvas unbalanced, and it must not kill the process over a
    // decorative effect.
    //
    // The concrete escape route on API 31+ (verified against BlurView
    // version-2.0.6, RenderEffectBlur.java): render() takes the RenderNode
    // path only when `canvas.isHardwareAccelerated()`. On a SOFTWARE canvas it
    // lazily builds a RenderScriptBlur fallback and calls
    // `fallbackAlgorithm.blur(bitmap, lastBlurRadius)` — with lastBlurRadius
    // being whatever blurAndSave() last passed, i.e. the tuned 40 that
    // setBlurRadius deliberately does NOT clamp on the RenderEffect path. That
    // lands in RenderScriptBlur.blur → blurScript.setRadius(40) → the same
    // RSIllegalArgumentException that crashed the 6T, on a device that never
    // goes near RenderScript otherwise.
    //
    // Clamping to 25 up front would fix it by giving up the tuned radius on
    // every 31+ device to protect a rare path, so: contain instead. Skipping
    // this frame is the correct degrade — the fallback is per-canvas, not
    // latched, so the next hardware-accelerated draw renders normally. Do NOT
    // set a permanent disable flag here; one screenshot would then flatten the
    // glass for the rest of the process.
    val base = canvas.saveCount
    canvas.save()
    try {
      canvas.scale(scaleFactorW, scaleFactorH)
      blurAlgorithm.render(canvas, internalBitmap)
    } catch (e: RuntimeException) {
      // Rate-limited on the paint-log clock: a software-layered ancestor draws
      // every frame, and logging per frame would bury the trace.
      if (drawAt - lastPaintLogUptime > PAINT_LOG_GAP_MS) {
        lastPaintLogUptime = drawAt
        Log.w(TAG, "render skipped: ${e.javaClass.simpleName} hw=${canvas.isHardwareAccelerated}")
      }
    } finally {
      try {
        canvas.restoreToCount(base)
      } catch (e: IllegalStateException) {
        Log.w(TAG, "render restore skipped: canvas unbalanced")
      }
    }
    if (overlayColor != PreDrawBlurController.TRANSPARENT) {
      canvas.drawColor(overlayColor)
    }
    return true
  }

  // Shielded so a blur throw cannot kill the process over a decorative
  // effect. That is ALL this does — read what the failure path actually
  // leaves on screen before adding anything to it:
  //
  // updateBlur() promotes BEFORE it blurs. One statement above the call to
  // this function, `internalCanvas.drawBitmap(stagingBitmap, promotePaint)`
  // full-replaces internalBitmap (promotePaint is PorterDuff.Mode.SRC — see
  // its own comment above) with this frame's sharp, 180%-saturated capture.
  // And in RenderScriptBlur.blur every throw site (createFromBitmap,
  // createTyped, setRadius, setInput, forEach) precedes the single write-back
  // (outAllocation.copyTo(bitmap)). So on a caught failure internalBitmap
  // holds the RAW capture — never a half-written bitmap, and never the
  // previous blurred frame, which the promote already destroyed.
  //
  // What that looks like differs by API branch, and only one of them is
  // benign:
  //   - API 31+: render() draws the RenderNode, which retains its last
  //     recording and RenderEffect, so the pill genuinely holds its previous
  //     look and a failure here is invisible.
  //   - API 26-30: render() is canvas.drawBitmap(internalBitmap), so the raw
  //     capture reaches the screen — a ~1/6-scale, 6x-upscaled, over-saturated
  //     mirror of the content behind, refreshed at the capture cap for as long
  //     as blurs keep failing. Ugly, but not a crash, which is the trade this
  //     shield exists to make.
  // Fixing that second case means a new degrade path in a file no build in
  // this environment can compile, for a failure never yet observed in the
  // field, so it is documented here and left for the emulator matrix rather
  // than written blind.
  //
  // NO re-init on repeated failure. The obvious move — post
  // updateBlurViewSize() the way the capture path does — does not do what it
  // reads as: init() early-returns whenever the scaled bitmap size is
  // unchanged (see its "keep the buffers" branch), and a blur failure never
  // changes the view's measured size, so that branch is taken every time and
  // Bitmap.createBitmap is never reached. It would buy one wasted post and one
  // extra unthrottled capture per three failures, on a device already short of
  // memory. The counter therefore only rate-limits the log.
  //
  // Its OWN counter, not the snapshot one. The capture pass sets
  // consecutiveFailures = 0 immediately before calling this, so sharing it
  // would reset the tally on every frame where the snapshot succeeded and only
  // the blur failed — precisely the case being counted.
  private fun blurAndSave() {
    val blurred = try {
      blurAlgorithm.blur(internalBitmap, blurRadius)
    } catch (e: RuntimeException) {
      consecutiveBlurFailures++
      // First one always, then sparsely: this runs at the capture cap, so an
      // unthrottled line here would flood logcat and bury the trace it exists
      // to produce.
      if (consecutiveBlurFailures == 1 ||
        consecutiveBlurFailures % BLUR_FAIL_LOG_EVERY == 0
      ) {
        Log.w(
          TAG,
          "blur failed x$consecutiveBlurFailures: ${e.javaClass.simpleName} " +
            "r=$blurRadius — showing the unblurred capture ${state()}",
        )
      }
      return
    }
    consecutiveBlurFailures = 0
    internalBitmap = blurred
    if (!blurAlgorithm.canModifyBitmap()) {
      internalCanvas.setBitmap(internalBitmap)
    }
  }

  override fun updateBlurViewSize() {
    init(blurView.measuredWidth, blurView.measuredHeight)
  }

  override fun destroy() {
    dead = true
    blurView.removeCallbacks(heartbeat)
    setBlurAutoUpdate(false)
    blurAlgorithm.destroy()
    initialized = false
  }

  // RenderScript's ScriptIntrinsicBlur.setRadius hard-throws outside (0, 25].
  // theme/tokens sets backdropRadius: 40 — deliberately, to match the web's
  // blur(40px), and its comment reasons about RenderEffect, which has no such
  // bound and runs at full resolution. But GlassViewManager only takes the
  // RenderEffect path on API 31+; below that it builds a RenderScriptBlur, and
  // 40 reaches setRadius unmodified and throws on the FIRST glass pre-draw:
  //
  //   RSIllegalArgumentException: Radius out of range (0 < r <= 25)
  //     at RenderScriptBlur.blur → GlassBlurController.blurAndSave
  //
  // The dock and the top bar are glass, so on every Android 11-or-older device
  // that is a crash a frame or two after launch. It went unseen because the
  // usual test handset is on 31+, where the clamp never applies. Field report:
  // OnePlus 6T, six consecutive APP CRASH(EXCEPTION) exits.
  //
  // Clamp only the RenderScript path, so 31+ keeps the tuned 40 exactly.
  // RenderScript also blurs a downscaled bitmap (SizeScaler over
  // blurAlgorithm.scaleFactor()), so 25 there is visually far stronger than 25
  // at full resolution — the ceiling costs much less than it reads.
  override fun setBlurRadius(radius: Float): BlurViewFacade {
    this.blurRadius =
      if (blurAlgorithm is RenderEffectBlur) {
        radius
      } else {
        radius.coerceIn(RS_MIN_RADIUS, RS_MAX_RADIUS)
      }
    return this
  }

  override fun setFrameClearDrawable(frameClearDrawable: Drawable?): BlurViewFacade {
    this.frameClearDrawable = frameClearDrawable
    return this
  }

  // Not part of BlurViewFacade — the manager talks to the concrete
  // controller for this one. null = fall back to the frame-clear drawable.
  fun setClearColor(color: Int?) {
    clearColor = color
  }

  override fun setBlurEnabled(enabled: Boolean): BlurViewFacade {
    this.blurEnabled = enabled
    setBlurAutoUpdate(enabled)
    blurView.invalidate()
    return this
  }

  // Mechanical arm/disarm of the capture listeners. The LIBRARY's
  // attach/detach lifecycle calls this directly — it must never carry
  // intent, and it no longer touches the heartbeat (which self-schedules).
  override fun setBlurAutoUpdate(enabled: Boolean): BlurViewFacade {
    armed = enabled
    rootView.viewTreeObserver.removeOnPreDrawListener(drawListener)
    blurView.viewTreeObserver.removeOnPreDrawListener(drawListener)
    if (enabled) {
      rootView.viewTreeObserver.addOnPreDrawListener(drawListener)
      // Track changes in the blurView window too (dialog windows).
      if (rootView.windowId != blurView.windowId) {
        blurView.viewTreeObserver.addOnPreDrawListener(drawListener)
      }
    }
    return this
  }

  // JS intent (the frozen prop) — the only writer of desiredAutoUpdate.
  fun setDesired(on: Boolean) {
    if (!on && desiredAutoUpdate) {
      // Start the clock for the leaked-hold warning in the heartbeat.
      desiredFalseSince = SystemClock.uptimeMillis()
    }
    desiredAutoUpdate = on
    setBlurAutoUpdate(on)
  }

  // Reassert the armed state from intent. Called from the view's attach
  // hook: the library's own attach re-arm is conditional on a transient
  // isHardwareAccelerated() read and can leave the listeners stranded.
  fun resyncArm() {
    Log.i(TAG, "resyncArm ${state()}")
    setBlurAutoUpdate(desiredAutoUpdate)
  }

  private companion object {
    const val TAG = "GlassBlur"
    // ScriptIntrinsicBlur's documented bound: 0 < r <= 25. Exceeding it is not
    // a clamp inside the platform, it is an RSIllegalArgumentException.
    const val RS_MIN_RADIUS = 1f
    const val RS_MAX_RADIUS = 25f
    const val REINIT_AFTER_FAILURES = 3
    // Blur failures arrive at the capture cap, so log the first and then one
    // in every N rather than one per frame.
    const val BLUR_FAIL_LOG_EVERY = 60
    const val HEARTBEAT_MS = 2000L
    const val CAPTURE_MIN_INTERVAL_MS = 30L
    // Only log a paint that follows a real gap — a run of ordinary frames is
    // noise. Comfortably above one heartbeat so a healed wedge always logs.
    const val PAINT_LOG_GAP_MS = 500L
    // How long a VISIBLE view may stay frozen before we call it out. The
    // 550ms nav-transition freeze must never trip this.
    const val FROZEN_WARN_MS = 5000L
    // Backoff for re-initing a view whose size still reads unusable. Slow
    // enough not to churn the preDraw listener, fast enough that a view which
    // becomes usable without a layout event is never stranded for long.
    const val REVIVE_RETRY_MS = 10000L
  }

  override fun setOverlayColor(overlayColor: Int): BlurViewFacade {
    if (this.overlayColor != overlayColor) {
      this.overlayColor = overlayColor
      blurView.invalidate()
    }
    return this
  }
}

// BlurView.blurController is package-private; this same-package installer is
// the supported-by-us replacement for setupWith().
fun BlurView.installGlassController(
  rootView: ViewGroup,
  algorithm: BlurAlgorithm,
  saturation: Float,
): GlassBlurController {
  blurController.destroy()
  val controller = GlassBlurController(
    this,
    rootView,
    PreDrawBlurController.TRANSPARENT,
    algorithm,
    saturation,
  )
  blurController = controller
  return controller
}
