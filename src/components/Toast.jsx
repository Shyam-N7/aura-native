import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Keyframe } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { subscribeToast } from '../lib/toast';
import { useTheme } from '../theme/ThemeContext';
import { Glass } from './ui/Glass';
import { type } from '../theme/tokens';
import { DUR } from '../theme/motion';

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
  const [current, setCurrent] = useState(null);

  useEffect(() => subscribeToast(setCurrent), []);

  useEffect(() => {
    if (!current) {
      return;
    }
    const id = setTimeout(
      () => setCurrent(c => (c?.id === current.id ? null : c)),
      DUR.toastIn + DUR.toastHold,
    );
    return () => clearTimeout(id);
  }, [current]);

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
          <Text style={[type.body, styles.text, { color: t.ink }]}>
            {current.message}
          </Text>
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
  },
  pill: {
    maxWidth: '82%',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  text: { fontFamily: 'HankenGrotesk-Medium' },
});
