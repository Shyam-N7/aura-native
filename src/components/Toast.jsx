import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Keyframe,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { subscribeToast } from '../lib/toast';
import { useTheme } from '../theme/ThemeContext';
import { Glass } from './ui/Glass';
import { Icon } from './Icon';
import { type } from '../theme/tokens';
import { DUR } from '../theme/motion';

// Success green — reads on all three themes; no theme has a success token.
const TICK_GREEN = '#3f9d6b';

// Web toast motion: rise 16 + scale .96 in, reverse out, short hold.
const enter = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 16 }, { scale: 0.96 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
}).duration(DUR.toastIn);
const exit = new Keyframe({
  0: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
  100: { opacity: 0, transform: [{ translateY: 16 }, { scale: 0.96 }] },
}).duration(DUR.toastIn);

// Renders the most recent toast (last-write-wins), ported from web Toast.jsx.
export function Toast() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [current, setCurrent] = useState(null);
  // The success tick pops in just after the pill lands — a beat of "done".
  // Shared-value driven (not entering props): the disc lives inside a churny
  // conditional view, the documented reanimated 4.2.3 abort class.
  const tickScale = useSharedValue(0);

  useEffect(() => subscribeToast(setCurrent), []);

  useEffect(() => {
    if (!current) {
      return;
    }
    if (current.tick) {
      tickScale.value = 0;
      tickScale.value = reduced
        ? 1
        : withDelay(
            DUR.toastIn * 0.6,
            withSpring(1, { mass: 1, stiffness: 320, damping: 14 }),
          );
    }
    const id = setTimeout(
      () => setCurrent(c => (c?.id === current.id ? null : c)),
      DUR.toastIn + DUR.toastHold,
    );
    return () => clearTimeout(id);
  }, [current, reduced, tickScale]);

  const tickStyle = useAnimatedStyle(() => ({
    transform: [{ scale: tickScale.value }],
  }));

  if (!current) {
    return null;
  }
  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, { bottom: insets.bottom + 88 }]}
    >
      <Animated.View key={current.id} entering={enter} exiting={exit}>
        <Glass radius={22} style={styles.pill}>
          <View style={styles.row}>
            {current.tick && (
              <Animated.View style={[styles.tick, tickStyle]}>
                <Icon name="check" size={11} color="#fff" strokeWidth={2.4} />
              </Animated.View>
            )}
            <Text style={[type.body, styles.text, { color: t.ink }]}>
              {current.message}
            </Text>
          </View>
        </Glass>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    // Topmost of everything. The player (elevation 14) and action sheets
    // (elevation 24) would otherwise bury a toast fired from over them — on
    // this device elevation outranks sibling paint order, so a toast added
    // from the open player never showed. The wrap is transparent + no-touch,
    // so this lifts draw order without a shadow, slab, or blocked taps.
    zIndex: 100,
    elevation: 40,
  },
  pill: {
    maxWidth: '82%',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tick: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: TICK_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontFamily: 'HankenGrotesk-Medium', flexShrink: 1 },
});
