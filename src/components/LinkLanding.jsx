import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  useReducedMotion,
  withTiming,
} from 'react-native-reanimated';
import { subscribeLanding, hideLanding, landingLabel } from '../lib/linkLanding';
import { useTheme } from '../theme/ThemeContext';
import { AuraLoader } from './ui/AuraLoader';
import { DUR } from '../theme/motion';

// The full-screen veil a tapped link arrives under: opaque theme background,
// the goo loader, and a line that knows its errand ("opening the song",
// "starting from 1:24"). Mounted beside Toast — the only overlay slot that
// exists on every flow branch — and NEVER a Modal (a Sheet's Modal would
// stack over it unpredictably; an absolute sibling is the house shape).
//
// Motion is Toast.jsx's exact pattern: one mounted shared value, timer-
// sequenced unmount, reduced-motion snaps. entering/exiting are banned here —
// a churny null-gated view is the documented reanimated 4.2.3 abort class.
//
// The 8s safety valve: getTrack carries no deadline (api/catalog.js — a
// deliberate choice there), so a hung fetch could otherwise imprison the
// screen behind a spinner. Every terminal path in App.handleLink also calls
// hideLanding(); this timer is the backstop, not the contract.
const SAFETY_MS = 8000;

export function LinkLanding() {
  const { t } = useTheme();
  const reduced = useReducedMotion();
  const [current, setCurrent] = useState(null);
  const veil = useSharedValue(0);

  useEffect(() => subscribeLanding(setCurrent), []);

  useEffect(() => {
    if (!current) {
      return undefined;
    }
    veil.value = reduced ? 1 : withTiming(1, { duration: DUR.toastIn });
    const safety = setTimeout(() => hideLanding(), SAFETY_MS);
    return () => clearTimeout(safety);
  }, [current, reduced, veil]);

  // Dismissal: the bus emits null; fade out, then unmount on a timer chain
  // (never a worklet callback), guarding against a newer show racing in.
  const [shown, setShown] = useState(null);
  useEffect(() => {
    if (current) {
      setShown(current);
      return undefined;
    }
    if (!shown) {
      return undefined;
    }
    veil.value = reduced ? 0 : withTiming(0, { duration: DUR.toastIn });
    const id = setTimeout(
      () => setShown(s => (s?.id === shown.id ? null : s)),
      reduced ? 0 : DUR.toastIn,
    );
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, reduced, veil]);

  const veilStyle = useAnimatedStyle(() => ({ opacity: veil.value }));

  if (!shown) {
    return null;
  }
  return (
    <Animated.View
      accessibilityLabel={landingLabel(shown)}
      style={[styles.veil, { backgroundColor: t.bg }, veilStyle]}
    >
      <AuraLoader label={landingLabel(shown)} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  veil: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 90,
    elevation: 30,
  },
});
