import React from 'react';
import { Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { DUR, EASE, PRESS, SPRING } from '../../theme/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// The web's universal press feedback: every interactive element compresses on
// :active (0.86–0.96) and springs back on release. UI-thread only.
export function PressScale({ to = PRESS.default, style, children, ...pressableProps }) {
  const scale = useSharedValue(1);
  const reduced = useReducedMotion();

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      {...pressableProps}
      onPressIn={(e) => {
        if (!reduced) scale.value = withTiming(to, { duration: DUR.press, easing: EASE.settle });
        pressableProps.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (!reduced) scale.value = withSpring(1, SPRING.snapback);
        pressableProps.onPressOut?.(e);
      }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}
