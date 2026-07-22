import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { Icon } from '../Icon';
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

// Where each step's spotlight lands and which gesture it acts out.
// target keys index into the measured rects PlayerSheet passes down.
const SPOT = {
  like: { target: 'art', radius: 15, affordance: 'tap' },
  swipe: { target: 'art', radius: 15, affordance: 'swipe' },
  hold: { target: 'art', radius: 15, affordance: 'hold' },
  queue: { target: 'band', radius: 999, affordance: 'up' },
  close: { target: 'top', radius: 24, affordance: 'down' },
};

const DIM = 0.5;

// ── gesture affordances — each acts out its gesture on a loop ────────────────

// Double-tap: two ripple rings blooming from the middle, a beat apart.
// Each shared value gets its OWN animation instance — reanimated animation
// objects are stateful and must never be assigned to two values.
const bloom = () =>
  withRepeat(
    withSequence(
      withTiming(1, { duration: 620, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 0 }),
      withDelay(760, withTiming(0, { duration: 0 })),
    ),
    -1,
  );

function TapPulse({ accent, reduced }) {
  const p1 = useSharedValue(0);
  const p2 = useSharedValue(0);
  useEffect(() => {
    if (reduced) {
      p1.value = 0.4;
      p2.value = 0;
      return undefined;
    }
    p1.value = bloom();
    p2.value = withDelay(170, bloom());
    return () => {
      cancelAnimation(p1);
      cancelAnimation(p2);
    };
  }, [p1, p2, reduced]);
  const r1 = useAnimatedStyle(() => ({
    opacity: 0.9 * (1 - p1.value),
    transform: [{ scale: 0.45 + 0.75 * p1.value }],
  }));
  const r2 = useAnimatedStyle(() => ({
    opacity: 0.9 * (1 - p2.value),
    transform: [{ scale: 0.45 + 0.75 * p2.value }],
  }));
  return (
    <View pointerEvents="none" style={styles.center}>
      <Animated.View style={[styles.tapRing, { borderColor: accent }, r1]} />
      <Animated.View style={[styles.tapRing, { borderColor: accent }, r2]} />
    </View>
  );
}

// Swipe: an arrow chip gliding side to side.
function SwipeGlide({ accent, bg, reduced }) {
  const x = useSharedValue(0);
  useEffect(() => {
    if (reduced) {
      return undefined;
    }
    x.value = withRepeat(
      withSequence(
        withTiming(16, { duration: 560, easing: Easing.inOut(Easing.sin) }),
        withTiming(-16, { duration: 560, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
    return () => cancelAnimation(x);
  }, [x, reduced]);
  const glide = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
  }));
  return (
    <View pointerEvents="none" style={styles.center}>
      <Animated.View style={[styles.chip, { backgroundColor: bg }, glide]}>
        <Icon name="arrow-right" size={18} color={accent} />
      </Animated.View>
    </View>
  );
}

// Hold: a soft press that lands, holds, and lets go — at the art's right edge.
function HoldPulse({ accent, reduced }) {
  const p = useSharedValue(0);
  useEffect(() => {
    if (reduced) {
      p.value = 1;
      return undefined;
    }
    p.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 380, easing: EASE.settle }),
        withTiming(1, { duration: 720 }),
        withTiming(0, { duration: 300, easing: EASE.exit }),
        withTiming(0, { duration: 420 }),
      ),
      -1,
    );
    return () => cancelAnimation(p);
  }, [p, reduced]);
  const press = useAnimatedStyle(() => ({
    opacity: 0.25 + 0.55 * p.value,
    transform: [{ scale: 0.82 + 0.18 * p.value }],
  }));
  return (
    <View pointerEvents="none" style={styles.holdSlot}>
      <Animated.View
        style={[styles.holdDot, { backgroundColor: accent }, press]}
      />
    </View>
  );
}

// Up/down: a chevron drifting the way the finger should.
function Drift({ dir, accent, reduced }) {
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduced) {
      return undefined;
    }
    y.value = withRepeat(
      withSequence(
        withTiming(dir * 9, {
          duration: 640,
          easing: Easing.inOut(Easing.sin),
        }),
        withTiming(dir * -5, {
          duration: 640,
          easing: Easing.inOut(Easing.sin),
        }),
      ),
      -1,
      true,
    );
    return () => cancelAnimation(y);
  }, [y, dir, reduced]);
  const drift = useAnimatedStyle(() => ({
    opacity: 0.95,
    transform: [{ translateY: y.value }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.center, drift]}>
      <View style={dir < 0 ? styles.flip : null}>
        <Icon name="chevron-down" size={26} color={accent} />
      </View>
    </Animated.View>
  );
}

function Affordance({ kind, t, reduced }) {
  switch (kind) {
    case 'tap':
      return <TapPulse accent={t.accent} reduced={reduced} />;
    case 'swipe':
      return <SwipeGlide accent={t.accent} bg={t.accentCard} reduced={reduced} />;
    case 'hold':
      return <HoldPulse accent={t.accent} reduced={reduced} />;
    case 'up':
      return <Drift dir={-1} accent={t.accent} reduced={reduced} />;
    case 'down':
      return <Drift dir={1} accent={t.accent} reduced={reduced} />;
    default:
      return null;
  }
}

// ── the tour overlay — spotlight cutout + ring + affordance + docked card ───
// The dim is four slabs AROUND the step's component, so the component itself
// stays bright and fully live (every touch passes: slabs and decorations are
// pointer-transparent; only the card's two buttons catch). The card docks
// next to whatever is lit. All motion is mounted shared values — never
// entering/exiting (the 4.2.3/Fabric abort class).
export function GestureTourOverlay({ reduced, targets }) {
  const { t } = useTheme();
  const [tour, setTour] = useState(getTourState);
  useEffect(() => subscribeTour(setTour), []);
  const [box, setBox] = useState(null);

  // Scene fade: through-black swap on every step change (rects reposition
  // while invisible), plus the initial entrance.
  const scene = useSharedValue(0);
  useEffect(() => {
    if (!tour.active) {
      return;
    }
    if (reduced) {
      scene.value = 1;
      return;
    }
    scene.value = 0;
    scene.value = withTiming(1, { duration: DUR.screen, easing: EASE.enter });
  }, [tour.active, tour.step, reduced, scene]);
  const sceneStyle = useAnimatedStyle(() => ({ opacity: scene.value }));
  // The ring breathes with the accent — alive, not a static border.
  const breathe = useSharedValue(0);
  useEffect(() => {
    if (!tour.active || reduced) {
      return undefined;
    }
    breathe.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 900, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
    return () => cancelAnimation(breathe);
  }, [tour.active, reduced, breathe]);
  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.65 + 0.35 * breathe.value,
    transform: [{ scale: 1 + 0.012 * breathe.value }],
  }));

  if (!tour.active) {
    return null;
  }
  const step = TOUR_STEPS[tour.step];
  const spec = SPOT[step.id];
  const r = targets?.[spec.target] ?? null;

  // Card docks under the lit component; for the bottom band it sits above
  // (falling back to the bottom anchor until the overlay has measured).
  const cardPos = !r
    ? { bottom: 118 }
    : spec.target === 'band'
      ? box
        ? { bottom: box.height - r.y + 14 }
        : { bottom: 118 }
      : { top: r.y + r.height + 14 };

  return (
    <View
      pointerEvents="box-none"
      style={styles.wrap}
      onLayout={e => setBox(e.nativeEvent.layout)}
    >
      <Animated.View pointerEvents="none" style={[styles.fill, sceneStyle]}>
        {r ? (
          <>
            {/* Four dim slabs leave a bright window over the component. */}
            <View style={[styles.slab, { height: r.y }, styles.slabTop]} />
            <View style={[styles.slab, styles.slabBottom, { top: r.y + r.height }]} />
            <View
              style={[
                styles.slab,
                styles.slabLeft,
                { top: r.y, height: r.height, width: r.x },
              ]}
            />
            <View
              style={[
                styles.slab,
                styles.slabRight,
                { top: r.y, height: r.height, left: r.x + r.width },
              ]}
            />
            {/* Accent ring hugging the window, breathing. */}
            <Animated.View
              style={[
                styles.ring,
                {
                  left: r.x - 5,
                  top: r.y - 5,
                  width: r.width + 10,
                  height: r.height + 10,
                  borderRadius: Math.min(spec.radius + 5, 999),
                  borderColor: t.accent,
                },
                ringStyle,
              ]}
            />
            {/* The gesture, acted out inside the window. */}
            <View
              style={[
                styles.stage,
                {
                  left: r.x,
                  top: r.y,
                  width: r.width,
                  height: r.height,
                },
              ]}
            >
              <Affordance kind={spec.affordance} t={t} reduced={reduced} />
            </View>
          </>
        ) : (
          // Rects not measured yet (first frames) — plain dim, card below.
          <View style={[styles.fill, styles.plainDim]} />
        )}
      </Animated.View>

      <Animated.View
        accessible
        accessibilityLabel={`gesture tour: ${step.how} to ${step.what}`}
        style={[
          styles.card,
          { backgroundColor: t.surface, borderColor: t.line },
          cardPos,
          sceneStyle,
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
  wrap: StyleSheet.absoluteFillObject,
  fill: StyleSheet.absoluteFillObject,
  plainDim: { backgroundColor: '#000', opacity: 0.32 },
  slab: {
    position: 'absolute',
    backgroundColor: '#000',
    opacity: DIM,
  },
  slabTop: { left: 0, right: 0, top: 0 },
  slabBottom: { left: 0, right: 0, bottom: 0 },
  slabLeft: { left: 0 },
  slabRight: { right: 0 },
  ring: {
    position: 'absolute',
    borderWidth: 2,
  },
  stage: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tapRing: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 999,
    borderWidth: 2.5,
  },
  chip: {
    width: 52,
    height: 52,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  holdSlot: {
    position: 'absolute',
    right: 16,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  holdDot: {
    width: 46,
    height: 46,
    borderRadius: 999,
  },
  flip: { transform: [{ rotate: '180deg' }] },
  card: {
    position: 'absolute',
    left: 20,
    right: 20,
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
