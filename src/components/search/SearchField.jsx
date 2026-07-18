import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Circle } from '@shopify/react-native-skia';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { Goo } from '../ui/Goo';
import { Icon } from '../Icon';
import { fonts } from '../../theme/tokens';

// The search field: a glassy capsule with a gooey accent aura breathing behind
// it — three metaball blobs (the dock's Skia pipeline) drift and fuse in the
// bleed around the pill, waking on focus. The capsule stays opaque so the query
// text is always crisp; the goo lives in the padding it bleeds into.
const H = 50; // capsule height
const PAD = 16; // goo bleed past the capsule on every side
const HOME = [0.28, 0.52, 0.76]; // blob home positions along the width

// A blob radius that breathes, staggered per blob so they don't pulse in
// lockstep (reads as liquid, not a heartbeat).
function radiusAt(p, i) {
  'worklet';
  const phase = (p + i * 0.33) % 1;
  const wave = Math.sin(phase * Math.PI * 2) * 0.5 + 0.5;
  return 15 + wave * 8;
}

export function SearchField({ inputRef, value, onChangeText, ...inputProps }) {
  const { t } = useTheme();
  const reduced = useReducedMotion();
  const [w, setW] = useState(0);

  const focus = useSharedValue(0); // 0 idle · 1 focused
  const drift = useSharedValue(0); // -1..1 slow lateral sweep
  const pulse = useSharedValue(0); // 0..1 radius breathing

  useEffect(() => {
    if (reduced) {
      return undefined;
    }
    drift.value = withRepeat(
      withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    pulse.value = withRepeat(
      withTiming(1, { duration: 1900, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(drift);
      cancelAnimation(pulse);
    };
  }, [reduced, drift, pulse]);

  const h0 = PAD + w * HOME[0];
  const h1 = PAD + w * HOME[1];
  const h2 = PAD + w * HOME[2];
  // Skia reads these derived shared values directly (dock-bud pattern).
  const cx0 = useDerivedValue(() => h0 + drift.value * 10, [h0]);
  const cx1 = useDerivedValue(() => h1 - drift.value * 10, [h1]);
  const cx2 = useDerivedValue(() => h2 + drift.value * 10, [h2]);
  const r0 = useDerivedValue(() => radiusAt(pulse.value, 0));
  const r1 = useDerivedValue(() => radiusAt(pulse.value, 1));
  const r2 = useDerivedValue(() => radiusAt(pulse.value, 2));

  const auraStyle = useAnimatedStyle(() => ({
    opacity: 0.22 + focus.value * 0.4,
  }));

  const canvasW = w + PAD * 2;
  const canvasH = H + PAD * 2;
  const cy = canvasH / 2;
  const cxs = [cx0, cx1, cx2];
  const rs = [r0, r1, r2];

  return (
    <View style={styles.wrap} onLayout={e => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[styles.aura, { left: -PAD, top: -PAD }, auraStyle]}
        >
          <Goo variant="subtle" style={{ width: canvasW, height: canvasH }}>
            {cxs.map((cx, i) => (
              <Circle key={i} cx={cx} cy={cy} r={rs[i]} color={t.accent} />
            ))}
          </Goo>
        </Animated.View>
      )}

      <View
        style={[
          styles.capsule,
          { backgroundColor: t.surface, borderColor: t.line },
        ]}
      >
        <Icon name="search" size={18} color={t.inkFaint} />
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => {
            focus.value = withSpring(1, { mass: 1, stiffness: 200, damping: 18 });
          }}
          onBlur={() => {
            focus.value = withTiming(0, { duration: 300 });
          }}
          placeholderTextColor={t.inkFaint}
          cursorColor={t.accent}
          selectionColor={t.accent}
          style={[styles.input, { color: t.ink }]}
          {...inputProps}
        />
        {value?.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="clear search"
            onPress={() => {
              onChangeText('');
              inputRef?.current?.focus();
            }}
            hitSlop={10}
            style={styles.clear}
          >
            <Icon name="close" size={16} color={t.inkFaint} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  aura: { position: 'absolute' },
  capsule: {
    height: H,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
  },
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 18,
    letterSpacing: -0.09,
    paddingVertical: 0,
  },
  clear: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
