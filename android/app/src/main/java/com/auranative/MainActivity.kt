package com.auranative

import android.os.Bundle
import android.util.Log
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * React re-renders the whole tree from JS, so Android's saved fragment state
   * is useless here — and react-native-screens throws "Screen fragments should
   * never be restored" if the activity relaunches with it after a process
   * death (field crash, 9× on 2026-07-14). Pass null per rn-screens issue #17.
   */
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
    requestFullRefreshRate()
  }

  /**
   * The OS picks the refresh rate PER APP, and ColorOS parks non-allowlisted
   * apps at 60Hz (measured live: launcher at 120, AURA at 60 on the same
   * panel). preferredDisplayModeId is the request OEMs honor: ask for the
   * highest-refresh mode at the current resolution and let the OS keep its
   * right to downshift (thermals, battery saver). The glass capture throttle
   * is time-based, so 120Hz makes scroll/gestures smoother without
   * re-inflating blur cost.
   */
  private fun requestFullRefreshRate() {
    val display = windowManager.defaultDisplay ?: return
    val current = display.mode ?: return
    val modes = display.supportedModes
    val best = modes
      .filter {
        it.physicalWidth == current.physicalWidth &&
          it.physicalHeight == current.physicalHeight
      }
      .maxByOrNull { it.refreshRate } ?: return
    // Diagnostic, because the two ways this silently does nothing are
    // indistinguishable from inside the app — both just leave the panel at
    // 60Hz (owner report, still 60 after this landed):
    //   1. the platform hands a non-allowlisted app a mode list containing
    //      only the current mode, so `best` IS `current` and the request below
    //      is never made at all;
    //   2. the request is made and the OS refuses the vote.
    // Log what was actually offered so logcat separates them. One line at
    // launch, no loop.
    Log.i(
      TAG,
      "display: current=${current.refreshRate}Hz modes=[" +
        modes.joinToString {
          "${it.physicalWidth}x${it.physicalHeight}@${it.refreshRate}"
        } + "]",
    )
    if (best.modeId != current.modeId) {
      window.attributes = window.attributes.apply {
        preferredDisplayModeId = best.modeId
      }
      Log.i(TAG, "requested modeId=${best.modeId} (${best.refreshRate}Hz)")
    } else {
      Log.i(
        TAG,
        "no higher mode offered at this resolution — nothing requested",
      )
    }
  }

  private companion object {
    const val TAG = "AuraDisplay"
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "AuraNative"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
