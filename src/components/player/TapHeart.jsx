import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  useReducedMotion,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Icon } from '../Icon';

// The Instagram moment, with the trimmings: a heart pops exactly where the
// double-tap landed — tilted a little differently every time, springing
// upright as it lands — while an accent ring swells and six sparks fan out.
// It holds a beat, floats up and fades. Pure feedback — the like itself is
// the caller's business. Re-fires on every burst.key; no timers, so there is
// nothing to leak — the final frame is fully transparent.
const POP_SPRING = { mass: 1, stiffness: 320, damping: 14 };
const TILT_SPRING = { mass: 1, stiffness: 180, damping: 12 };
const SIZE = 68;
const SPARK_REACH = 56;

// Off-axis angles so the fan reads organic, not like a compass rose.
const SPARKS = [15, 75, 135, 195, 255, 315].map(deg => ({
  deg,
  x: Math.cos((deg * Math.PI) / 180),
  y: Math.sin((deg * Math.PI) / 180),
}));

export function TapHeart({ burst, accent }) {
  const reduced = useReducedMotion();
  const pop = useSharedValue(0); // heart scale (spring overshoots past 1)
  const tilt = useSharedValue(0); // degrees, springs back to upright
  const rise = useSharedValue(0);
  const fade = useSharedValue(0);
  const fx = useSharedValue(1); // ring + sparks progress (1 = spent/hidden)

  useEffect(() => {
    if (!burst || reduced) {
      return; // reduced motion: the heart fill + toast already confirm it
    }
    pop.value = 0;
    rise.value = 0;
    fade.value = 1;
    tilt.value = Math.random() * 24 - 12;
    fx.value = 0;
    pop.value = withSpring(1, POP_SPRING);
    tilt.value = withSpring(0, TILT_SPRING);
    fx.value = withTiming(1, {
      duration: 560,
      easing: Easing.out(Easing.ease),
    });
    rise.value = withDelay(
      430,
      withTiming(-52, { duration: 340, easing: Easing.out(Easing.ease) }),
    );
    fade.value = withDelay(
      430,
      withTiming(0, { duration: 300, easing: Easing.out(Easing.ease) }),
    );
  }, [burst, reduced, pop, tilt, rise, fade, fx]);

  const heartStyle = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [
      { translateY: rise.value },
      { rotate: `${tilt.value}deg` },
      { scale: pop.value },
    ],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: fx.value >= 1 ? 0 : (1 - fx.value) * 0.8,
    transform: [{ scale: 0.5 + fx.value * 1.1 }],
  }));

  if (!burst || reduced) {
    return null;
  }
  return (
    <View
      pointerEvents="none"
      style={[
        styles.stage,
        { left: burst.x - SIZE / 2, top: burst.y - SIZE / 2 },
      ]}
    >
      <Animated.View
        style={[styles.ring, { borderColor: accent }, ringStyle]}
      />
      {SPARKS.map(s => (
        <TapSpark key={s.deg} spark={s} fx={fx} accent={accent} />
      ))}
      <Animated.View style={[styles.heart, heartStyle]}>
        {/* Soft dark drop under a white rim under an accent core — depth on
            bright art, presence on dark art. */}
        <View style={styles.drop}>
          <Icon name="heart-filled" size={SIZE} color="rgba(0,0,0,0.30)" />
        </View>
        <Icon name="heart-filled" size={SIZE} color="rgba(255,255,255,0.94)" />
        <View style={styles.core}>
          <Icon name="heart-filled" size={52} color={accent} />
        </View>
      </Animated.View>
    </View>
  );
}

// One flung spark — its own component so the animated style is a proper
// top-level hook; all six read the single shared progress.
function TapSpark({ spark, fx, accent }) {
  const style = useAnimatedStyle(() => ({
    opacity: fx.value >= 1 ? 0 : 1 - fx.value,
    transform: [
      { translateX: spark.x * fx.value * SPARK_REACH },
      { translateY: spark.y * fx.value * SPARK_REACH },
      { scale: 1 - fx.value * 0.4 },
    ],
  }));
  return (
    <Animated.View
      style={[styles.spark, { backgroundColor: accent }, style]}
    />
  );
}

const styles = StyleSheet.create({
  stage: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heart: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  drop: {
    position: 'absolute',
    transform: [{ translateY: 3 }],
  },
  core: { position: 'absolute' },
  ring: {
    position: 'absolute',
    width: SIZE * 1.3,
    height: SIZE * 1.3,
    borderRadius: (SIZE * 1.3) / 2,
    borderWidth: 2,
  },
  spark: {
    position: 'absolute',
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
});
