import React, { useEffect } from 'react';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';

// Pulsing placeholder block — the native stand-in for the web home's shimmer
// skeletons (hero band, stations, new-for-you while the pool loads).
export function Skeleton({ height, radius = 14, style }) {
  const { t } = useTheme();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0.55);

  useEffect(() => {
    if (!reduced) {
      pulse.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
    }
    // An infinite repeat outlives its component on the UI thread unless it's
    // cancelled — skeletons churn per load, so orphans would pile up.
    return () => cancelAnimation(pulse);
  }, [pulse, reduced]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={[
        { height, borderRadius: radius, backgroundColor: t.surface },
        animated,
        style,
      ]}
    />
  );
}
