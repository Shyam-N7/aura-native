import React, { useEffect, useState } from 'react';
import {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

// A number that rolls up to its value when the data lands (and glides between
// values when a refresh nudges them) — the arrival ceremony for stat lines
// like the You tab's "your year". Reanimated-driven so reduced motion snaps
// straight to the value. Render it inside a <Text>. (jest.setup stubs this to
// the plain final number — the mock clock never finishes withTiming.)
export function CountUp({ to = 0 }) {
  const sv = useSharedValue(0);
  const [n, setN] = useState(0);
  useEffect(() => {
    sv.value = withTiming(to, {
      duration: 900,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    });
  }, [to, sv]);
  useAnimatedReaction(
    () => Math.round(sv.value),
    (v, prev) => {
      if (v !== prev) {
        runOnJS(setN)(v);
      }
    },
  );
  return <>{n}</>;
}
