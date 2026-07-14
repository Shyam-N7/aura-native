import React, { useEffect } from 'react';
import { useIsFocused } from '@react-navigation/native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { DUR, EASE } from '../../theme/motion';

// The web's route transition (fade + rise 14 + scale .985) replayed every time a
// tab gains focus; tabs themselves switch with animation:'none' underneath.
export function ScreenFade({ duration = DUR.screen, easing = EASE.enter, style, children }) {
  const focused = useIsFocused();
  const progress = useSharedValue(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (focused) {
      progress.value = 0;
      progress.value = reduced ? 1 : withTiming(1, { duration, easing });
    }
  }, [focused, duration, easing, progress, reduced]);

  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: (1 - progress.value) * 14 },
      { scale: 0.985 + progress.value * 0.015 },
    ],
  }));

  return <Animated.View style={[{ flex: 1 }, animated, style]}>{children}</Animated.View>;
}
