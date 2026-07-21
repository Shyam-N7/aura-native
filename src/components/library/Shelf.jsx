import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { fonts } from '../../theme/tokens';
import { DUR, EASE } from '../../theme/motion';

// One library shelf, ported from web DesktopLibrary's accordion: the head is
// always visible (title + living peek + a plus that turns into a ×), the body
// expands in place. The web's grid-rows 0fr→1fr CSS trick becomes a layout
// transition: the card resizes around its mounting body while siblings slide.
// Collapsed content is simply not rendered, which also keeps it out of the
// a11y tree (the web needed a delayed visibility:hidden for that).
const SHELF_LAYOUT = LinearTransition.duration(280).reduceMotion(
  ReduceMotion.System,
);

// The body's fade-in as a plain animated style, not an `entering` layout
// animation: this mounts inside YouScreen, whose whole navigator a session
// expiry can tear down mid-flight — the reanimated 4.2.3/Fabric native-abort
// class. A shared value cancels cleanly instead.
function BodyFade({ style, children }) {
  const reduced = useReducedMotion();
  const p = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (!reduced) {
      p.value = withTiming(1, { duration: DUR.dot, easing: EASE.settle });
    }
  }, [p, reduced]);
  const fade = useAnimatedStyle(() => ({ opacity: p.value }));
  return <Animated.View style={[style, fade]}>{children}</Animated.View>;
}

export function Shelf({ title, peek, open, onToggle, hint, children }) {
  const { t } = useTheme();
  const turn = useSharedValue(open ? 1 : 0);

  useEffect(() => {
    turn.value = withTiming(open ? 1 : 0, {
      duration: DUR.dot,
      easing: EASE.settle,
    });
  }, [open, turn]);

  const plusStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.value * 45}deg` }],
  }));

  return (
    <Animated.View
      layout={SHELF_LAYOUT}
      style={[
        styles.shelf,
        { backgroundColor: t.surface, borderColor: t.line },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => [styles.head, pressed && styles.pressed]}
      >
        <Text style={[styles.title, { color: t.ink }]}>{title}</Text>
        {/* The container always renders so the plus stays parked at the right
            edge; the peek itself eases out while the shelf is open. */}
        <View style={styles.peek}>{!open && peek}</View>
        <Animated.Text
          style={[styles.plus, { color: t.inkFaint }, plusStyle]}
          accessible={false}
        >
          +
        </Animated.Text>
      </Pressable>
      {hint}
      {open && <BodyFade style={styles.body}>{children}</BodyFade>}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shelf: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  pressed: { opacity: 0.7 },
  title: {
    fontFamily: fonts.semibold,
    fontSize: 19,
    letterSpacing: -0.1,
    flexShrink: 1,
  },
  peek: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  plus: {
    fontFamily: fonts.regular,
    fontSize: 24,
    lineHeight: 26,
    marginLeft: 4,
  },
  body: {
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
});
