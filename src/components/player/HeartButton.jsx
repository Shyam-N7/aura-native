import React from 'react';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { Pressable } from 'react-native';
import { Icon } from '../Icon';
import { useLikes } from '../../hooks/useLikes';
import { showToast } from '../../lib/toast';
import { DUR, EASE, SPRING } from '../../theme/motion';

// The like toggle used everywhere (player, liked rows), ported from web
// HeartButton.jsx: optimistic — the toast fires BEFORE the network call, the
// heart fills instantly, and the store rolls back (heart empties) on failure.
export function HeartButton({ trackId, size = 20, color, accent }) {
  const { isLiked, like, unlike } = useLikes();
  const liked = isLiked(trackId);
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const pop = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const toggle = () => {
    if (!reduced) {
      // The web's burst, condensed to a pop: squeeze then overshoot back.
      scale.value = withSequence(
        withTiming(0.7, { duration: DUR.press, easing: EASE.settle }),
        withSpring(1, SPRING.snapback),
      );
    }
    showToast(liked ? 'removed from likes.' : 'liked.');
    (liked ? unlike(trackId) : like(trackId)).catch(() => {
      showToast("couldn't like — try again.");
    });
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={liked ? 'unlike' : 'like'}
      onPress={toggle}
      hitSlop={10}
    >
      <Animated.View style={pop}>
        <Icon
          name={liked ? 'heart-filled' : 'heart'}
          size={size}
          color={liked ? accent : color}
          strokeWidth={1.7}
        />
      </Animated.View>
    </Pressable>
  );
}
