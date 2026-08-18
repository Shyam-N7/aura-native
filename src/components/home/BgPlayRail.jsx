import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { useMotionGate } from '../../hooks/useMotionGate';
import { label } from '../../theme/tokens';
import { DUR, EASE } from '../../theme/motion';

const KNOB = 30;
const PAD = 3;
const BAR_COUNT = 9;

// One EQ bar of the rail. Own component so each bar owns its shared value
// (hooks can't live in a map). The loop runs ONLY while the switch is on AND
// the app is foregrounded AND motion is wanted — an invisible infinite
// animation under a dark screen is exactly the leak class that killed
// screen-off playback once, and nine of them under a reduced-motion setting
// is nine loops the listener explicitly asked not to see.
function EqBar({ index, animate, on, reduced, color }) {
  const sx = useSharedValue(0.34);
  useEffect(() => {
    if (animate) {
      const d = 900 + (index % 4) * 230;
      sx.value = withDelay(
        index * 80,
        withRepeat(
          withSequence(
            withTiming(1, { duration: d / 2 }),
            withTiming(0.34, { duration: d / 2 }),
          ),
          -1,
          true,
        ),
      );
      return () => cancelAnimation(sx);
    }
    cancelAnimation(sx);
    // The parked height IS the bar's final value, so reduced motion lands on
    // it in one frame instead of easing there. Everything else (a paused
    // loop behind another tab, the switch going off) keeps the 200ms settle.
    const rest = on ? 1 : 0.34;
    sx.value = reduced ? rest : withTiming(rest, { duration: 200 });
    return undefined;
  }, [animate, on, reduced, index, sx]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scaleX: sx.value }],
  }));
  return (
    <Animated.View style={[styles.bar, { backgroundColor: color }, style]} />
  );
}

// The 2b header rail (owner's reference): the rail IS the switch — a full-
// height vertical track whose "BG" knob travels top (on) to bottom (off),
// with the EQ bars breathing inside while background play is on. Replaces
// the OtterToggle + label box.
export function BgPlayRail({ value, onPress }) {
  const { t } = useTheme();
  // All three gates or the bars run unwanted: app-active covers screen-off,
  // focus covers Home parked behind another tab (tabs keep screens mounted),
  // reduced covers the OS setting. mayLoop is exactly that conjunction.
  const { reduced, mayLoop } = useMotionGate();
  const [railH, setRailH] = useState(0);

  const pos = useSharedValue(value ? 0 : 1);
  useEffect(() => {
    const to = value ? 0 : 1;
    pos.value = reduced
      ? to
      : withTiming(to, { duration: DUR.dot, easing: EASE.settle });
  }, [value, reduced, pos]);
  const travel = Math.max(0, railH - KNOB - PAD * 2);
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pos.value * travel }],
  }));

  const animate = value && mayLoop;

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel="background play"
      onPress={onPress}
      onLayout={e => setRailH(e.nativeEvent.layout.height)}
      style={[
        styles.rail,
        { backgroundColor: value ? t.accentSoft : t.line },
      ]}
    >
      {/* Bars sit centered in the track; the knob slides over them and its
          opaque disc covers whichever end it parks at (the 2b look). */}
      <View pointerEvents="none" style={styles.barsBox}>
        {Array.from({ length: BAR_COUNT }, (_, i) => (
          <EqBar
            key={i}
            index={i}
            animate={animate}
            on={value}
            reduced={reduced}
            color={value ? t.accent : t.inkFaint}
          />
        ))}
      </View>
      <Animated.View
        style={[
          styles.knob,
          { backgroundColor: value ? t.accent : t.accentCard },
          knobStyle,
        ]}
      >
        <Text style={[label(8), { color: value ? t.bg : t.inkSoft }]}>BG</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rail: {
    width: 36,
    flex: 1,
    minHeight: 78,
    borderRadius: 18,
    padding: PAD,
  },
  barsBox: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  bar: {
    width: 20,
    height: 2.5,
    borderRadius: 1.25,
    opacity: 0.55,
  },
  knob: {
    position: 'absolute',
    top: PAD,
    left: PAD,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
