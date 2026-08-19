import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Circle } from '@shopify/react-native-skia';
import {
  cancelAnimation,
  Easing,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { useAppActive } from '../../hooks/useAppActive';
import { useNavFocused } from '../../hooks/useNavFocused';
import { Goo } from './Goo';
import { label, space } from '../../theme/tokens';

// The house loader: three accent blobs that pulse and fuse under the goo
// metaball filter, so "loading" reads as something alive rather than a spinner.
// Same Skia pipeline as the dock's bud. reduced-motion holds them still.
const W = 72;
const H = 34;
const CY = H / 2;
const XS = [22, 36, 50];
const RMIN = 4.5;
const RMAX = 9;

export function AuraLoader({ label: text, style }) {
  const { t } = useTheme();
  const reduced = useReducedMotion();
  // Park the blobs when nobody can see them. Most callers unmount this the
  // moment their data lands, so the loop lives a second or two and the gate
  // never matters — but the YouTube import holds a loader for the length of a
  // fetch, on a screen whose poll deliberately keeps running while parked and
  // which actively invites the user to switch away mid-import. ColorOS keeps
  // delivering animation frames with the screen off; the heapprofd capture in
  // reports/10 measured ~40 MB/min of native heap leaked from exactly that.
  const appActive = useAppActive();
  const focused = useNavFocused();
  const animate = !reduced && appActive && focused;
  const r0 = useSharedValue(RMIN);
  const r1 = useSharedValue(RMAX);
  const r2 = useSharedValue(RMIN);
  const blobs = [r0, r1, r2];

  useEffect(() => {
    if (!animate) {
      // Rest at the mid radius: still visibly three blobs, just not breathing.
      blobs.forEach(cancelAnimation);
      r0.value = 7;
      r1.value = 7;
      r2.value = 7;
      return undefined;
    }
    blobs.forEach((r, i) => {
      r.value = withDelay(
        i * 160,
        withRepeat(
          withTiming(i === 1 ? RMIN : RMAX, {
            duration: 620,
            easing: Easing.inOut(Easing.sin),
          }),
          -1,
          true,
        ),
      );
    });
    return () => blobs.forEach(cancelAnimation);
    // shared values are stable refs; run once per visibility state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate]);

  return (
    <View style={[styles.wrap, style]}>
      <Goo variant="subtle" style={styles.canvas}>
        {XS.map((x, i) => (
          <Circle key={i} cx={x} cy={CY} r={blobs[i]} color={t.accent} />
        ))}
      </Goo>
      {!!text && (
        <Text style={[label(9.5), styles.text, { color: t.inkFaint }]}>
          {text}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: space.s8 },
  canvas: { width: W, height: H },
  text: { textAlign: 'center' },
});
