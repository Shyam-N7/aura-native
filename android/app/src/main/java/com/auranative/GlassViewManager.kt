package com.auranative

import android.content.Context
import android.os.Build
import android.util.Log
import android.view.View
import android.view.ViewGroup
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import eightbitlab.com.blurview.BlurView
import eightbitlab.com.blurview.GlassBlurController
import eightbitlab.com.blurview.RenderEffectBlur
import eightbitlab.com.blurview.RenderScriptBlur
import eightbitlab.com.blurview.installGlassController

/**
 * True backdrop blur for the glass chrome — the one thing RN styles can't do
 * on Android (RenderEffect blurs a view's OWN content, not what's behind it).
 * Dimezis BlurView snapshots the content beneath and blurs it, taking the
 * RenderEffect GPU path on API 31+ (the target device runs 34).
 *
 * The JS side renders this as the bottom layer inside a Glass pill; the pill's
 * borderRadius + overflow clip it, and the tint/shimmer stack paints on top.
 * It re-blurs whenever the root invalidates — a live cost while content
 * scrolls beneath, fine for two 52dp bars, so never stack more of these.
 */

/**
 * Props land BEFORE the blur controller exists (setup can only run once the
 * view is attached and the React root is laid out), and BlurView silently
 * drops setBlurRadius calls on its no-op controller. Park the radius here so
 * setup applies what JS actually asked for — without this, the mount-time
 * radius vanished and every pill ran the default (owner-visible as card
 * edges surviving the too-weak blur).
 */
class GlassBlurView(context: Context) : BlurView(context) {
  var pendingRadius = GlassViewManager.DEFAULT_RADIUS
  var pendingFrozen = false
  var pendingClearColor: Int? = null
  var controllerReady = false
  var controller: GlassBlurController? = null

  // Arriving on screen (tab switch): force a draw pass so the armed preDraw
  // captures a fresh snapshot now that coordinates are real — the controller
  // deliberately skips captures while hidden.
  override fun onVisibilityAggregated(isVisible: Boolean) {
    super.onVisibilityAggregated(isVisible)
    if (isVisible) {
      invalidate()
    }
  }

  // Detail pushes re-parent this view routinely (react-native-screens), and
  // the library's attach hook re-arms captures ONLY when a transient
  // isHardwareAccelerated() read says true — when it reads false the
  // controller stays disarmed forever (the transparent-pill wedge,
  // 2026-08-02). Re-arm from JS intent instead, and log both edges so any
  // future lifecycle churn is diagnosable from logcat.
  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    // Geometry on BOTH edges: the detach/attach pair is what proves whether a
    // stack pop restores the view at its previous size (in which case Fabric
    // sends no updateLayout and onSizeChanged never fires) or at a new one.
    Log.i(TAG, "attached ready=$controllerReady frozen=$pendingFrozen $geom")
    controller?.resyncArm()
    // Re-run init on the way back in. A detach can have left the controller
    // holding WILL_NOT_DRAW from a zero-size measure, and nothing else will
    // clear it: onSizeChanged does not fire when the size returns to the value
    // it already had, which is exactly what a stack pop restores. Waiting for
    // the heartbeat would work eventually, but that is up to two seconds of a
    // visibly empty bar on every back press.
    //
    // Cheap to call: init() keeps the existing buffers when the scaled bitmap
    // size is unchanged, so the common case allocates nothing.
    controller?.updateBlurViewSize()
    invalidate()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    Log.i(TAG, "detached $geom")
  }

  private val geom: String
    get() = "w=$width h=$height mw=$measuredWidth mh=$measuredHeight " +
      "hw=$isHardwareAccelerated"

  private companion object {
    const val TAG = "GlassBlur"
  }
}

class GlassViewManager : SimpleViewManager<GlassBlurView>() {
  override fun getName() = "GlassView"

  override fun createViewInstance(ctx: ThemedReactContext): GlassBlurView {
    val blurView = GlassBlurView(ctx)
    // Set up once attached — the React root isn't laid out at create time.
    // BlurView's own attach/detach hooks handle every re-attach after this.
    blurView.addOnAttachStateChangeListener(
      object : View.OnAttachStateChangeListener {
        override fun onViewAttachedToWindow(v: View) {
          if (blurView.controllerReady) return
          val activity = ctx.currentActivity ?: return
          val root =
            activity.findViewById<ViewGroup>(android.R.id.content) ?: return
          // frameClearDrawable = the window background: without it the
          // snapshot starts from an undefined buffer and the blur can paint
          // the bare white window instead of the content behind (the failure
          // that sank the first capture-blur trial).
          // Web recipe is blur(40px) saturate(180%): the saturate rides
          // the controller's promote copy — without it the pill washes out
          // against vivid content and its edge reads as a line. Blur takes
          // the GPU RenderEffect path on 31+ (controller wires its context
          // in init), RenderScript below. installGlassController = the
          // stock controller with the crash shield (ScreenStack draw-op
          // races; see GlassBlurController).
          val controller = blurView.installGlassController(
            root,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
              RenderEffectBlur()
            } else {
              RenderScriptBlur(activity)
            },
            WEB_SATURATION,
          )
          controller
            .setFrameClearDrawable(activity.window.decorView.background)
            .setBlurRadius(blurView.pendingRadius)
          controller.setClearColor(blurView.pendingClearColor)
          // Intent entry — arms/disarms the capture loop as a side effect.
          controller.setDesired(!blurView.pendingFrozen)
          blurView.controller = controller
          blurView.controllerReady = true
        }

        override fun onViewDetachedFromWindow(v: View) = Unit
      },
    )
    return blurView
  }

  @ReactProp(name = "blurRadius", defaultFloat = DEFAULT_RADIUS)
  fun setBlurRadius(view: GlassBlurView, radius: Float) {
    view.pendingRadius = radius
    if (view.controllerReady) {
      view.setBlurRadius(radius)
    }
  }

  // Theme background for the staging clear coat (see GlassBlurController).
  // JS passes processColor(t.bg) — opaque, so 0 is a safe "unset" sentinel
  // that falls back to the decorView drawable. Same pending-prop parking as
  // blurRadius: props land before the controller exists.
  @ReactProp(name = "clearColor", defaultInt = 0)
  fun setClearColor(view: GlassBlurView, color: Int) {
    val c = if (color == 0) null else color
    view.pendingClearColor = c
    view.controller?.setClearColor(c)
  }

  // Frozen = keep drawing the LAST snapshot instead of re-capturing each
  // frame. JS freezes the glass for the navigation-transition window: the
  // per-frame root redraw the capture forces was interfering with the stack's
  // pop animation (the outgoing screen froze while the incoming one wiped
  // over it), and CSS backdrop-filter never redraws ancestors mid-transition.
  @ReactProp(name = "frozen", defaultBoolean = false)
  fun setFrozen(view: GlassBlurView, frozen: Boolean) {
    view.pendingFrozen = frozen
    // Intent, not mechanics: setDesired records what JS wants so the
    // heartbeat and attach-resync can restore the armed state after any
    // library-lifecycle stranding.
    view.controller?.setDesired(!frozen)
  }

  companion object {
    // BlurView's RenderEffect path applies this at snapshot resolution;
    // the JS side passes the web-matched value (tokens glass.backdropRadius).
    const val DEFAULT_RADIUS = 20f

    // Web glass: backdrop-filter saturate(180%).
    const val WEB_SATURATION = 1.8f
  }
}
