import React from 'react';
import { StyleSheet, Text, Vibration, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { fonts, space } from '../../theme/tokens';
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

// One assistive step: a whole decibel, the granularity the readout already
// ticks in while dragging (and the ±15 dB hardware range is 30 steps wide).
const STEP_MB = 100;

// Offered to assistive tech ONLY — a pan is unreachable with a screen reader
// on, exactly like the queue's drag.
const A11Y_ACTIONS = [
  { name: 'increment', label: 'louder' },
  { name: 'decrement', label: 'quieter' },
];

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

  // The number follows the finger, and each whole decibel ticks. Both are
  // driven off ONE reaction that only fires when the DISPLAYED dB changes —
  // not per frame — so a drag never floods JS (the same trick the player's
  // scrub timer uses) and the haptics land one per step instead of a buzz.
  const [liveDb, setLiveDb] = React.useState(null);
  const step = db => {
    setLiveDb(db);
    Vibration.vibrate(4);
  };
  const endLive = () => setLiveDb(null);
  useAnimatedReaction(
    () =>
      dragging.value
        ? Math.round((max - (y.value / (TRACK_H - KNOB)) * span) / 100)
        : null,
    (db, prev) => {
      if (db === prev) {
        return;
      }
      if (db == null) {
        runOnJS(endLive)();
      } else {
        runOnJS(step)(db);
      }
    },
    [min, max],
  );

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

  // Pre-computed on the JS thread: a worklet may only call other worklets, so
  // toY() cannot be invoked from inside one — but a captured NUMBER is fine.
  // (Calling it in the worklet is what crashed the app on long-press.)
  const zeroY = toY(0);
  // Likewise Vibration.vibrate is a native-module method and loses its binding
  // through runOnJS; it has to be wrapped in a plain function.
  const tickReset = () => Vibration.vibrate(12);

  const reset = Gesture.LongPress()
    .enabled(!disabled)
    .minDuration(380)
    .onStart(() => {
      'worklet';
      y.value = withTiming(zeroY, { duration: 200, easing: EASE.settle });
      runOnJS(commit)(0);
      // A firmer tick than a drag step — the band snapped back to flat.
      runOnJS(tickReset)();
    });

  // The assistive equivalent of the drag: one decibel per press, off the
  // DISPLAYED value so a press always lands on a whole dB even if the band
  // sits on an odd millibel from a preset.
  const nudge = dir => {
    if (disabled) {
      return;
    }
    const from = Math.round(value / STEP_MB) * STEP_MB;
    const next = Math.min(max, Math.max(min, from + dir * STEP_MB));
    if (next === value) {
      return;
    }
    y.value = withTiming(toY(next), { duration: 160, easing: EASE.settle });
    commit(next);
  };
  const onA11yAction = e => {
    const action = e.nativeEvent?.actionName;
    if (action === 'increment') {
      nudge(1);
    } else if (action === 'decrement') {
      nudge(-1);
    }
  };

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

  // While dragging, the live value wins — the label is the readout.
  const db = liveDb ?? Math.round(value / 100);
  const live = liveDb != null;
  return (
    <View style={styles.wrap}>
      <Text
        style={[
          styles.db,
          { color: db === 0 && !live ? t.inkFaint : t.accent },
          live && styles.dbLive,
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
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={`band ${label}`}
            accessibilityValue={{
              min: Math.round(min / 100),
              max: Math.round(max / 100),
              now: db,
              text: `${db} decibels`,
            }}
            accessibilityState={{ disabled: !!disabled }}
            accessibilityActions={A11Y_ACTIONS}
            onAccessibilityAction={onA11yAction}
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
  wrap: { alignItems: 'center', gap: space.s8, flex: 1 },
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
  // The readout grows a touch under the finger so the number you're setting
  // stands out from its four neighbours.
  dbLive: { fontFamily: fonts.semibold, fontSize: 13.5 },
  label: { fontFamily: fonts.regular, fontSize: 11 },
  dim: { opacity: 0.4 },
});
