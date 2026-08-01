// Lives in the library package for setContext access (package-private). The
// whole APK shares one classloader, so the runtime package check passes too.
package eightbitlab.com.blurview

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.os.Build

/**
 * The web glass recipe is `backdrop-filter: blur(40px) saturate(180%)` — blur
 * alone leaves the pill washed out against vivid content behind it (owner-
 * visible as a hard tonal line where the pill edge crosses the red hero
 * card). Saturation is a linear per-pixel transform, so it commutes with the
 * Gaussian: applying it to the snapshot BEFORE the blur is visually identical
 * to CSS's after-blur order, and costs one filtered composite at snapshot
 * (downscaled) resolution.
 */
class GlassSaturatingBlur(context: Context, saturation: Float) : BlurAlgorithm {
  private val delegate: BlurAlgorithm =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      RenderEffectBlur().also { it.setContext(context) }
    } else {
      RenderScriptBlur(context)
    }

  private val paint = Paint().apply {
    colorFilter = ColorMatrixColorFilter(
      ColorMatrix().apply { setSaturation(saturation) },
    )
  }

  override fun blur(bitmap: Bitmap, blurRadius: Float): Bitmap {
    // saveLayer keeps src and dst distinct (drawing a bitmap onto its own
    // canvas is undefined); restore() composites the layer back through the
    // saturation filter.
    val canvas = Canvas(bitmap)
    canvas.saveLayer(
      0f,
      0f,
      bitmap.width.toFloat(),
      bitmap.height.toFloat(),
      paint,
    )
    canvas.drawBitmap(bitmap, 0f, 0f, null)
    canvas.restore()
    return delegate.blur(bitmap, blurRadius)
  }

  override fun destroy() = delegate.destroy()

  override fun canModifyBitmap() = delegate.canModifyBitmap()

  override fun getSupportedBitmapConfig(): Bitmap.Config =
    delegate.supportedBitmapConfig

  override fun scaleFactor() = delegate.scaleFactor()

  override fun render(canvas: Canvas, bitmap: Bitmap) =
    delegate.render(canvas, bitmap)
}
