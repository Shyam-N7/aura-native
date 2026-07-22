import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { PressScale } from '../ui/PressScale';
import {
  TOUR_STEPS,
  endTour,
  getTourState,
  skipTourStep,
  subscribeTour,
} from '../../lib/gestureTour';
import { fonts, label } from '../../theme/tokens';
import { DUR, EASE } from '../../theme/motion';

// The do-it-live tour card: a quiet dim over the player and ONE step at a
// time, anchored above the up-next band so every gesture target (art, the
// band, the top edge) stays clear and live — the step completes only when
// the real gesture is performed. Renders nothing while the tour is off.
export function GestureTourOverlay({ reduced }) {
  const { t } = useTheme();
  const [tour, setTour] = useState(getTourState);
  useEffect(() => subscribeTour(setTour), []);

  // Content fade on step change (and on the dim at mount) — mounted shared
  // values only, never entering/exiting (the 4.2.3/Fabric abort class).
  const dim = useSharedValue(0);
  const fade = useSharedValue(1);
  const prevStep = useRef(tour.step);
  useEffect(() => {
    if (!tour.active) {
      return;
    }
    dim.value = reduced
      ? 0.32
      : withTiming(0.32, { duration: DUR.screen, easing: EASE.enter });
  }, [tour.active, reduced, dim]);
  useEffect(() => {
    if (tour.step === prevStep.current) {
      return;
    }
    prevStep.current = tour.step;
    if (reduced) {
      return;
    }
    fade.value = 0;
    fade.value = withTiming(1, { duration: DUR.dot, easing: EASE.enter });
  }, [tour.step, reduced, fade]);
  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.value }));
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  if (!tour.active) {
    return null;
  }
  const step = TOUR_STEPS[tour.step];
  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <Animated.View
        pointerEvents="none"
        style={[styles.dim, dimStyle]}
      />
      <Animated.View
        accessible
        accessibilityLabel={`gesture tour: ${step.how} to ${step.what}`}
        style={[
          styles.card,
          { backgroundColor: t.surface, borderColor: t.line },
          fadeStyle,
        ]}
      >
        <Text style={[label(9), { color: t.accent }]}>
          {`try it · ${tour.step + 1} of ${TOUR_STEPS.length}`}
        </Text>
        <Text style={[styles.how, { color: t.ink }]}>{step.how}</Text>
        <Text style={[styles.what, { color: t.inkSoft }]}>{step.what}</Text>
        <View style={styles.row}>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel="skip this step"
            onPress={skipTourStep}
            hitSlop={8}
          >
            <Text style={[styles.btn, { color: t.inkSoft }]}>
              skip this one
            </Text>
          </PressScale>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel="skip the tour"
            onPress={endTour}
            hitSlop={8}
          >
            <Text style={[styles.btn, { color: t.inkFaint }]}>
              skip the tour
            </Text>
          </PressScale>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    // Clears the queue-hint row + up-next band, so "swipe up" stays live
    // right under the card.
    paddingBottom: 118,
    paddingHorizontal: 20,
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 4,
  },
  how: { fontFamily: fonts.semibold, fontSize: 17 },
  what: { fontFamily: fonts.regular, fontSize: 13 },
  row: { flexDirection: 'row', gap: 22, marginTop: 10 },
  btn: { fontFamily: fonts.medium, fontSize: 13 },
});
