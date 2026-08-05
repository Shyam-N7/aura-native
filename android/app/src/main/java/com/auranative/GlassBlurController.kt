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
  private var lastSuccessUptime = 0L
  private var lastCaptureUptime = 0L

  // Immortal: posted at construction, always re-posts, only destroy() stops
  // it. A no-op tick every 2s is free; what it buys is that NO interleaving
  // of library lifecycle, rns re-parenting, or freeze-timer ordering can
  // permanently silence captures — any stranded state heals in ≤2s while a
  // legitimate freeze (desired=false) stays frozen.
  private val heartbeat = object : Runnable {
    override fun run() {
      if (dead) {
        return
      }
      if (desiredAutoUpdate) {
        if (!initialized && blurView.isLaidOut && blurView.width > 0) {
          // init() during a transient zero-size layout leaves
          // initialized=false with nothing scheduled to retry —
          // onSizeChanged may never fire again (the size returns to its
          // old value), and draw() contributes nothing (the transparent
          // pill). Re-init now that the view has a real size.
          Log.w(TAG, "heartbeat: reviving uninitialized controller")
          updateBlurViewSize()
          blurView.invalidate()
        } else if (
          initialized &&
          // Screen off / behind another window: no one can see the glass —
          // don't burn snapshot work while parked. Clipped away: nothing to
          // refresh, and forcing invalidates would churn at 0.5Hz forever.
          // The wedges this heals (view VISIBLE, snapshot stale or capture
          // loop disarmed) still pass both tests.
          blurView.hasWindowFocus() &&
          blurView.isLaidOut &&
          blurView.getGlobalVisibleRect(visibleRect) &&
          SystemClock.uptimeMillis() - lastSuccessUptime > HEARTBEAT_MS
        ) {
          // force: a stale snapshot is exactly what the throttle must not
          // block.
          Log.w(TAG, "heartbeat: stale snapshot, re-arming capture loop")
          setBlurAutoUpdate(true)
          updateBlur(force = true)
          blurView.invalidate()
        }
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
    if (!blurView.isLaidOut || !blurView.getGlobalVisibleRect(visibleRect)) {
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
        // Something is persistently wrong with this controller's state —
        // rebuild it (fresh bitmaps, fresh listeners) outside this pass.
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

    val scaleFactorH = blurView.height.toFloat() / internalBitmap.height
    val scaleFactorW = blurView.width.toFloat() / internalBitmap.width

    canvas.save()
    canvas.scale(scaleFactorW, scaleFactorH)
    blurAlgorithm.render(canvas, internalBitmap)
    canvas.restore()
    if (overlayColor != PreDrawBlurController.TRANSPARENT) {
      canvas.drawColor(overlayColor)
    }
    return true
  }

  private fun blurAndSave() {
    internalBitmap = blurAlgorithm.blur(internalBitmap, blurRadius)
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

  override fun setBlurRadius(radius: Float): BlurViewFacade {
    this.blurRadius = radius
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
    desiredAutoUpdate = on
    setBlurAutoUpdate(on)
  }

  // Reassert the armed state from intent. Called from the view's attach
  // hook: the library's own attach re-arm is conditional on a transient
  // isHardwareAccelerated() read and can leave the listeners stranded.
  fun resyncArm() {
    setBlurAutoUpdate(desiredAutoUpdate)
  }

  private companion object {
    const val TAG = "GlassBlur"
    const val REINIT_AFTER_FAILURES = 3
    const val HEARTBEAT_MS = 2000L
    const val CAPTURE_MIN_INTERVAL_MS = 30L
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
