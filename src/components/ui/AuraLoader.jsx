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
import { Goo } from './Goo';
import { label } from '../../theme/tokens';

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
  const r0 = useSharedValue(RMIN);
  const r1 = useSharedValue(RMAX);
  const r2 = useSharedValue(RMIN);
  const blobs = [r0, r1, r2];

  useEffect(() => {
    if (reduced) {
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
    // shared values are stable refs; run once per reduced-motion state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

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
  wrap: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 8 },
  canvas: { width: W, height: H },
  text: { textAlign: 'center' },
});
