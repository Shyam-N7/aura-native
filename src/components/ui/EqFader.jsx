import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { fonts } from '../../theme/tokens';
import { EASE } from '../../theme/motion';

// One equalizer band, as a vertical fader. Same machinery as the player's
// scrub (pan → shared value → animated transform, all on the UI thread): the
// knob follows the finger at 60fps while JS only hears the settled value, so
// dragging never floods the bridge with native effect calls.
//
// Long-press re-zeros the band — deliberately NOT double-tap, which would race
// the pan recognizer on a control this narrow.

const TRACK_H = 168;
const KNOB = 22;

export function EqFader({
  label,
  value, // millibels
  min,
  max,
  disabled,
  onChange, // (millibels) — fired on release and on long-press reset
}) {
  const { t } = useTheme();
  const span = max - min;
  const toY = mb => ((max - mb) / span) * (TRACK_H - KNOB);
  const y = useSharedValue(toY(value));
  const startY = useSharedValue(0);
  const dragging = useSharedValue(0);

  // Follow external changes (preset applied, profile swapped on route change)
  // — but never while the finger is down, or the knob would fight the drag.
  React.useEffect(() => {
    if (!dragging.value) {
      y.value = withTiming(toY(value), { duration: 220, easing: EASE.settle });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, min, max]);

  const commit = mb => onChange?.(mb);

  const pan = Gesture.Pan()
    .enabled(!disabled)
    .minDistance(0)
    .onBegin(() => {
      'worklet';
      dragging.value = 1;
      startY.value = y.value;
    })
    .onUpdate(e => {
      'worklet';
      y.value = Math.min(TRACK_H - KNOB, Math.max(0, startY.value + e.translationY));
    })
    .onEnd(() => {
      'worklet';
      const mb = max - (y.value / (TRACK_H - KNOB)) * span;
      runOnJS(commit)(mb);
    })
    .onFinalize(() => {
      'worklet';
      dragging.value = 0;
    });

  const reset = Gesture.LongPress()
    .enabled(!disabled)
    .minDuration(380)
    .onStart(() => {
      'worklet';
      y.value = withTiming(toY(0), { duration: 200, easing: EASE.settle });
      runOnJS(commit)(0);
    });

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
  }));
  // The lit part of the track runs from the knob to the centre line, so a cut
  // reads as clearly as a boost instead of both looking like "some fill".
  const fillStyle = useAnimatedStyle(() => {
    const mid = (TRACK_H - KNOB) / 2;
    const top = Math.min(y.value, mid) + KNOB / 2;
    return { top, height: Math.abs(y.value - mid) };
  });

  const db = Math.round(value / 100);
  return (
    <View style={styles.wrap}>
      <Text
        style={[
          styles.db,
          { color: db === 0 ? t.inkFaint : t.accent },
          disabled && styles.dim,
        ]}
      >
        {db > 0 ? `+${db}` : db}
      </Text>
      <GestureDetector gesture={Gesture.Exclusive(reset, pan)}>
        <View style={[styles.track, disabled && styles.dim]}>
          <View style={[styles.rail, { backgroundColor: t.line }]} />
          <View style={[styles.mid, { backgroundColor: t.line }]} />
          <Animated.View
            style={[styles.fill, { backgroundColor: t.accent }, fillStyle]}
          />
          <Animated.View
            accessibilityLabel={`band ${label}`}
            accessibilityValue={{ text: `${db} decibels` }}
            style={[
              styles.knob,
              { backgroundColor: t.accent, borderColor: t.bg },
              knobStyle,
            ]}
          />
        </View>
      </GestureDetector>
      <Text style={[styles.label, { color: t.inkSoft }, disabled && styles.dim]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 8, flex: 1 },
  track: {
    width: 34,
    height: TRACK_H,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  rail: {
    position: 'absolute',
    top: KNOB / 2,
    bottom: KNOB / 2,
    width: 2,
    borderRadius: 2,
  },
  mid: {
    position: 'absolute',
    top: TRACK_H / 2 - 0.5,
    width: 14,
    height: 1,
    opacity: 0.8,
  },
  fill: { position: 'absolute', width: 3, borderRadius: 2 },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    borderWidth: 3,
  },
  db: { fontFamily: fonts.medium, fontSize: 11.5 },
  label: { fontFamily: fonts.regular, fontSize: 11 },
  dim: { opacity: 0.4 },
});
