import React, { useEffect, useState } from 'react';
import { requireNativeComponent, UIManager } from 'react-native';
import { subscribeGlassFreeze } from '../../lib/navFreeze';

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

const NativeGlassView = cache.component;

// The mount-time blurRadius prop reaches the view BEFORE its blur controller
// exists (setup runs on attach), so it lands on a no-op and attach resets the
// radius to the manager default — card edges behind the bars survived as
// visible lines at the weaker blur (owner field report). Re-assert the radius
// a frame after mount so it reaches the LIVE controller. The manager caches
// the pending radius as of the next binary; this stays as the belt for
// binaries built before that.
function RadiusAsserted({ blurRadius, suspended = false, ...rest }) {
  const [radius, setRadius] = useState(undefined);
  // Navigation transitions freeze the capture loop (lib/navFreeze) so the
  // per-frame root redraw can't disturb the stack animation. `suspended`
  // rides the same native prop: Glass parks the backdrop through goo windows
  // instead of unmounting it (captures off, view alive).
  const [frozen, setFrozen] = useState(false);
  useEffect(() => subscribeGlassFreeze(setFrozen), []);
  useEffect(() => {
    const id = requestAnimationFrame(() => setRadius(blurRadius));
    return () => cancelAnimationFrame(id);
  }, [blurRadius]);
  return (
    <NativeGlassView
      {...rest}
      blurRadius={radius}
      frozen={frozen || suspended}
    />
  );
}

export const GlassBackdrop = NativeGlassView ? RadiusAsserted : null;
