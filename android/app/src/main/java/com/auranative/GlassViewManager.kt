package com.auranative

import android.content.Context
import android.view.View
import android.view.ViewGroup
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import eightbitlab.com.blurview.BlurView
import eightbitlab.com.blurview.GlassSaturatingBlur
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
  var controllerReady = false
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
          blurView
            // Web recipe is blur(40px) saturate(180%): the saturating
            // algorithm chains the missing saturate — without it the pill
            // washes out against vivid content and its edge reads as a line.
            // installGlassController = the stock controller with the crash
            // shield (ScreenStack draw-op races; see GlassBlurController).
            .installGlassController(
              root,
              GlassSaturatingBlur(activity, WEB_SATURATION),
            )
            .setFrameClearDrawable(activity.window.decorView.background)
            .setBlurRadius(blurView.pendingRadius)
            .setBlurAutoUpdate(!blurView.pendingFrozen)
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

  // Frozen = keep drawing the LAST snapshot instead of re-capturing each
  // frame. JS freezes the glass for the navigation-transition window: the
  // per-frame root redraw the capture forces was interfering with the stack's
  // pop animation (the outgoing screen froze while the incoming one wiped
  // over it), and CSS backdrop-filter never redraws ancestors mid-transition.
  @ReactProp(name = "frozen", defaultBoolean = false)
  fun setFrozen(view: GlassBlurView, frozen: Boolean) {
    view.pendingFrozen = frozen
    if (view.controllerReady) {
      view.setBlurAutoUpdate(!frozen)
    }
  }

  companion object {
    // BlurView's RenderEffect path applies this at snapshot resolution;
    // the JS side passes the web-matched value (tokens glass.backdropRadius).
    const val DEFAULT_RADIUS = 20f

    // Web glass: backdrop-filter saturate(180%).
    const val WEB_SATURATION = 1.8f
  }
}
