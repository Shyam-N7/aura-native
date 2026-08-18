import { useMemo } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import { useAppActive } from './useAppActive';
import { useNavFocused } from './useNavFocused';

// The whole motion contract in one read, because keeping it as a convention
// is what let it leak.
//
// Three independent signals decide whether a piece of motion is allowed to
// run, and until now every call site imported them separately (34 direct
// `useReducedMotion()` imports, plus useAppActive/useNavFocused where someone
// remembered) — so the ones that forgot a signal looked exactly like the ones
// that didn't need it:
//
//   reduced    — the OS accessibility setting. A gated animation must land on
//                its FINAL value instantly: never mid-flight, never hidden.
//   appActive  — the app is foregrounded. Android keeps delivering animation
//                frames with the screen OFF (reports/10: ~40 MB/min of native
//                heap from per-frame worklet execution + Fabric mounts, ending
//                in a process kill at ~741 MB).
//   navFocused — the owning screen is the focused one. Tabs and the native
//                stack keep parked screens MOUNTED, so "did it mount" is not
//                "is it on screen"; every tick behind another tab still forces
//                the glass views to re-capture the tree.
//
// `mayLoop` is the answer for the case that actually burns a battery: an
// INFINITE animation (withRepeat(..., -1)). A loop is only allowed while
// motion is wanted, the app is visible, and the screen is the one being
// looked at. One-shot transitions need only `reduced` — they end on their own.
//
// Stopping and resuming is the required behaviour on an appActive/navFocused
// flip: cancelAnimation and leave the value where it is, then start the loop
// again from there. Resetting to a seed value on every background/foreground
// bounce is what makes a parked screen come back visibly broken.
export function useMotionGate() {
  // Reanimated can hand back null before the setting has been read; unknown
  // reads as "motion is fine", matching every existing call site.
  const reduced = !!useReducedMotion();
  const appActive = useAppActive();
  const navFocused = useNavFocused();

  // Memoised so the object can safely be a hook dependency at a call site.
  return useMemo(
    () => ({
      reduced,
      appActive,
      navFocused,
      mayLoop: !reduced && appActive && navFocused,
    }),
    [reduced, appActive, navFocused],
  );
}
