import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
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

// Renders the most recent toast (last-write-wins), ported from web Toast.jsx.
// Web toast motion: rise 16 + scale .96 in, reverse out, short hold — all
// driven by ONE mounted shared value. entering/exiting props are banned here:
// the pill is a null-gated view replaced per toast, the documented reanimated
// 4.2.3 abort class (an exit animation on a churny conditional view aborts
// the native process — this was crashing the app in the field).
export function Toast() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [current, setCurrent] = useState(null);
  // 0 → hidden, 1 → landed. Drives opacity/rise/scale of the pill.
  const pill = useSharedValue(0);
  // The success tick pops in just after the pill lands — a beat of "done".
  const tickScale = useSharedValue(0);

  useEffect(() => subscribeToast(setCurrent), []);

  useEffect(() => {
    if (!current) {
      return;
    }
    pill.value = 0;
    pill.value = reduced ? 1 : withTiming(1, { duration: DUR.toastIn });
    if (current.tick) {
      tickScale.value = 0;
      tickScale.value = reduced
        ? 1
        : withDelay(
            DUR.toastIn * 0.6,
            withSpring(1, { mass: 1, stiffness: 320, damping: 14 }),
          );
    }
    // Hold, animate out, THEN unmount — the timer chain (not a worklet
    // callback) sequences it, and both timers clear if a newer toast lands.
    let unmountId = null;
    const outId = setTimeout(() => {
      pill.value = reduced ? 0 : withTiming(0, { duration: DUR.toastIn });
      unmountId = setTimeout(
        () => setCurrent(c => (c?.id === current.id ? null : c)),
        reduced ? 0 : DUR.toastIn,
      );
    }, DUR.toastIn + DUR.toastHold);
    return () => {
      clearTimeout(outId);
      if (unmountId) {
        clearTimeout(unmountId);
      }
    };
  }, [current, reduced, pill, tickScale]);

  const pillStyle = useAnimatedStyle(() => ({
    opacity: pill.value,
    transform: [
      { translateY: 16 * (1 - pill.value) },
      { scale: 0.96 + 0.04 * pill.value },
    ],
  }));

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
      <Animated.View style={pillStyle}>
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
