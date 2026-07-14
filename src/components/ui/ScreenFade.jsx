import React, { useContext, useEffect } from 'react';
import { NavigationContext } from '@react-navigation/native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { DUR, EASE } from '../../theme/motion';

// The web's route transition (fade + rise 14 + scale .985) replayed every time a
// tab gains focus; tabs themselves switch with animation:'none' underneath.
// Reads the navigation context raw (no useIsFocused) so screens still render
// standalone — e.g. under jest — with a single play on mount.
export function ScreenFade({ duration = DUR.screen, easing = EASE.enter, style, children }) {
  const navigation = useContext(NavigationContext);
  const progress = useSharedValue(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    const play = () => {
      progress.value = 0;
      progress.value = reduced ? 1 : withTiming(1, { duration, easing });
    };
    play();
    return navigation?.addListener?.('focus', play);
  }, [navigation, duration, easing, progress, reduced]);

  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: (1 - progress.value) * 14 },
      { scale: 0.985 + progress.value * 0.015 },
    ],
  }));

  return <Animated.View style={[styles.fill, animated, style]}>{children}</Animated.View>;
}

const styles = { fill: { flex: 1 } };
