import React, { useEffect } from 'react';
import Animated, {
  LinearTransition,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { EASE } from '../../theme/motion';

// The one list-motion vocabulary. Rows that arrive incrementally look the same
// wherever they arrive (playlist import stream, the You shelves), and lists
// that mutate in place settle the same way (liked/unlike, re-sort, load-more).
// Before this, the same track row rose in on one screen, appeared instantly on
// another, and drifted for 2.8s on a third.

// Row settling for lists that MUTATE IN PLACE — rows leaving, re-sorting or
// appending slide to their new slot instead of teleporting.
//
// Arm it only on those lists. The layout-animation machinery runs a per-cell
// pass every frame while it is enabled (the QueueSheet drag-jitter finding),
// so a list that never reorders should pay nothing — which is why
// PlaylistScreen arms it only while its import stream is live.
export const ROW_LAYOUT = LinearTransition.duration(220).reduceMotion(
  ReduceMotion.System,
);

// The stagger is capped: a wave of 200 imported tracks reads as a quick
// cascade, not a minute of drip. Past the cap every row shares the last slot's
// delay, so the tail lands together.
const STAGGER_MS = 70;
const STAGGER_CAP = 6;
const ARRIVE_MS = 380;
const RISE_PX = 14;

/**
 * One arriving row materializing: fade + 14px rise, staggered by list position.
 *
 * <RowArrive i={index}>{row}</RowArrive>              — always animates
 * <RowArrive animate={isNew} i={n}>{row}</RowArrive>  — animates only when true
 *
 * `i` is the position WITHIN THE ARRIVING BATCH (0-based), not the list index —
 * callers streaming a tail subtract the pre-batch length so each wave restarts
 * the cascade.
 *
 * Driven by a plain animated style, NOT an `entering=` layout animation. Two
 * reasons, both load-bearing:
 *   - A session that expires under us tears the whole navigator down (auth 401
 *     → clearSession → Shell swaps to the sign-in screen), and reanimated
 *     4.2.3 on Fabric aborts natively when a view is removed mid-`entering`. A
 *     shared value is simply cancelled on unmount.
 *   - `entering=` is tied to mount, so it could only be armed by mounting.
 *     Here the tree shape never changes: flipping `animate` restyles the row,
 *     it never remounts it — a remount would blink every already-settled row
 *     the moment a stream ends.
 *
 * Reduced motion skips the animation entirely rather than shortening it: the
 * value is born parked at 1, so the row is simply there.
 */
export function RowArrive({ animate = true, i = 0, children }) {
  const reduced = useReducedMotion();
  const on = animate && !reduced;
  const v = useSharedValue(on ? 0 : 1);
  useEffect(() => {
    if (!on) {
      v.value = 1;
      return undefined;
    }
    v.value = 0;
    v.value = withDelay(
      STAGGER_MS * Math.min(i, STAGGER_CAP),
      withTiming(1, { duration: ARRIVE_MS, easing: EASE.enter }),
    );
    return () => cancelAnimation(v);
  }, [on, i, v]);
  const style = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ translateY: (1 - v.value) * RISE_PX }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}
