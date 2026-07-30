import { requireNativeComponent, UIManager } from 'react-native';

// True backdrop blur behind the glass chrome — the app-local GlassView
// component (android/.../GlassViewManager.kt, Dimezis BlurView underneath).
// Probe before requiring: a binary built before the glass-blur phase (or
// jest's mocked UIManager) has no such view manager, and Glass then simply
// keeps its tint-only recipe — the blur is an additive layer, never a
// prerequisite.
//
// The component is cached on globalThis because Fast Refresh re-evaluates
// this module, and a second requireNativeComponent('GlassView') throws
// "Tried to register two views with the same name" — the registry outlives
// the module instance, so the cache must too.
const cache = (global.__auraGlassBackdrop ??= {});
if (cache.component === undefined) {
  try {
    cache.component = UIManager.hasViewManagerConfig?.('GlassView')
      ? requireNativeComponent('GlassView')
      : null;
  } catch {
    cache.component = null;
  }
}

export const GlassBackdrop = cache.component;
