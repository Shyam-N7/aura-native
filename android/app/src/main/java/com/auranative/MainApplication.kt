package com.auranative

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.memory.MemoryCache
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication, ImageLoaderFactory {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        },
    )
  }

  /**
   * Coil's singleton loader serves exactly one consumer here: KotlinAudio's
   * notification/lock-screen artwork (RN's own images go through Fresco).
   * Its default memory cache budgets ~25% of the app's memory class and
   * fills with one ~1.5MB hardware bitmap per played track — measured as
   * linear EGL/gralloc growth on long screen-off sessions, feeding the OOM
   * kills this app exists to avoid. A handful of covers is all the
   * notification ever needs; 8MB keeps back-skips instant and the GPU
   * memory flat.
   */
  override fun newImageLoader(): ImageLoader =
    ImageLoader.Builder(this)
      .memoryCache {
        MemoryCache.Builder(this)
          .maxSizeBytes(8 * 1024 * 1024)
          .build()
      }
      .build()

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
