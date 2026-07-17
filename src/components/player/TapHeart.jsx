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

// The Instagram moment: a heart pops exactly where the double-tap landed,
// holds a beat, then floats up and fades. Pure feedback — the like itself is
// the caller's business. Re-fires on every burst.key; no timers, so there is
// nothing to leak — the final frame is fully transparent.
const POP_SPRING = { mass: 1, stiffness: 320, damping: 14 };
const SIZE = 64;

export function TapHeart({ burst, accent }) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(0);
  const rise = useSharedValue(0);
  const fade = useSharedValue(0);

  useEffect(() => {
    if (!burst || reduced) {
      return; // reduced motion: the heart fill + toast already confirm it
    }
    scale.value = 0;
    rise.value = 0;
    fade.value = 1;
    scale.value = withSpring(1, POP_SPRING);
    rise.value = withDelay(
      420,
      withTiming(-44, { duration: 340, easing: Easing.out(Easing.ease) }),
    );
    fade.value = withDelay(
      420,
      withTiming(0, { duration: 300, easing: Easing.out(Easing.ease) }),
    );
  }, [burst, reduced, scale, rise, fade]);

  const style = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ translateY: rise.value }, { scale: scale.value }],
  }));

  if (!burst || reduced) {
    return null;
  }
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.heart,
        { left: burst.x - SIZE / 2, top: burst.y - SIZE / 2 },
        style,
      ]}
    >
      {/* White rim under an accent core — visible on any cover art. */}
      <Icon name="heart-filled" size={SIZE} color="rgba(255,255,255,0.92)" />
      <View style={styles.core} pointerEvents="none">
        <Icon name="heart-filled" size={48} color={accent} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  heart: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  core: { position: 'absolute' },
});
