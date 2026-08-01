// Same package as the library: BlurView.blurController is package-private,
// and this controller reuses BlurViewCanvas/SizeScaler. One APK, one
// classloader — the runtime package check passes.
package eightbitlab.com.blurview

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
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
) : BlurController {

  private var blurRadius = BlurController.DEFAULT_BLUR_RADIUS

  private lateinit var internalCanvas: BlurViewCanvas
  private lateinit var internalBitmap: Bitmap
  private lateinit var stagingCanvas: BlurViewCanvas
  private lateinit var stagingBitmap: Bitmap

  private val rootLocation = IntArray(2)
  private val blurViewLocation = IntArray(2)

  // Full-replace composite for promoting staging → internal (SRC ignores
  // whatever the last blur left in the destination).
  private val promotePaint = Paint().apply {
    xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC)
  }

  private val drawListener = ViewTreeObserver.OnPreDrawListener {
    // Not invalidating a View here, just updating the Bitmap.
    updateBlur()
    true
  }

  private var blurEnabled = true
  private var initialized = false
  private var frameClearDrawable: Drawable? = null

  // Self-heal state. The theme-switch re-render storm wedged the top bar's
  // controller once (snapshot updates dead while the page moved on — the
  // pill kept a stale midnight frame on the bloom page, owner-visible).
  // Whatever the exact wedge path, the controller must not be able to STAY
  // wedged: repeated caught failures force a re-init, and a heartbeat
  // re-arms the listeners + refreshes whenever no successful snapshot has
  // landed in a while.
  private var autoUpdateWanted = true
  private var consecutiveFailures = 0
  private var lastSuccessUptime = 0L

  private val heartbeat = object : Runnable {
    override fun run() {
      if (!autoUpdateWanted) {
        return
      }
      if (
        initialized &&
        SystemClock.uptimeMillis() - lastSuccessUptime > HEARTBEAT_MS
      ) {
        // Re-arm defensively (add/remove is idempotent; this also re-posts
        // the heartbeat, so return instead of double-posting) and refresh.
        setBlurAutoUpdate(true)
        updateBlur()
        blurView.invalidate()
        return
      }
      blurView.postDelayed(this, HEARTBEAT_MS)
    }
  }

  init {
    if (blurAlgorithm is RenderEffectBlur) {
      blurAlgorithm.setContext(blurView.context)
    }
    init(blurView.measuredWidth, blurView.measuredHeight)
  }

  private fun init(measuredWidth: Int, measuredHeight: Int) {
    // Respect the CURRENT armed state — a resize during a freeze window
    // must not silently re-enable captures (the stock controller forces
    // true here).
    setBlurAutoUpdate(autoUpdateWanted)
    val sizeScaler = SizeScaler(blurAlgorithm.scaleFactor())
    if (sizeScaler.isZeroSized(measuredWidth, measuredHeight)) {
      // Will be initialized later when the View reports a size change.
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

  private fun updateBlur() {
    if (!blurEnabled || !initialized) {
      return
    }

    val clear = frameClearDrawable
    if (clear == null) {
      stagingBitmap.eraseColor(Color.TRANSPARENT)
    } else {
      clear.draw(stagingCanvas)
    }

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
      stagingCanvas.restore()
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

  override fun setBlurEnabled(enabled: Boolean): BlurViewFacade {
    this.blurEnabled = enabled
    setBlurAutoUpdate(enabled)
    blurView.invalidate()
    return this
  }

  override fun setBlurAutoUpdate(enabled: Boolean): BlurViewFacade {
    autoUpdateWanted = enabled
    rootView.viewTreeObserver.removeOnPreDrawListener(drawListener)
    blurView.viewTreeObserver.removeOnPreDrawListener(drawListener)
    blurView.removeCallbacks(heartbeat)
    if (enabled) {
      rootView.viewTreeObserver.addOnPreDrawListener(drawListener)
      // Track changes in the blurView window too (dialog windows).
      if (rootView.windowId != blurView.windowId) {
        blurView.viewTreeObserver.addOnPreDrawListener(drawListener)
      }
      blurView.postDelayed(heartbeat, HEARTBEAT_MS)
    }
    return this
  }

  private companion object {
    const val TAG = "GlassBlur"
    const val REINIT_AFTER_FAILURES = 3
    const val HEARTBEAT_MS = 2000L
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
): BlurViewFacade {
  blurController.destroy()
  val controller = GlassBlurController(
    this,
    rootView,
    PreDrawBlurController.TRANSPARENT,
    algorithm,
  )
  blurController = controller
  return controller
}
