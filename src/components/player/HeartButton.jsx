import React, { useEffect, useRef } from 'react';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '../Icon';
import { useLikes } from '../../hooks/useLikes';
import { showToast } from '../../lib/toast';
import { DUR, EASE } from '../../theme/motion';

// Overshoots hard on release — the like should feel like it lands.
const LIKE_SPRING = { mass: 1, stiffness: 320, damping: 11 };

// Six dots flung outward on like, evenly fanned.
const PARTICLES = [0, 60, 120, 180, 240, 300].map(deg => ({
  deg,
  x: Math.cos((deg * Math.PI) / 180),
  y: Math.sin((deg * Math.PI) / 180),
}));

// The celebration around a heart when `liked` flips true: an accent ring
// swells and fades while six particles fly out. Purely decorative overlay —
// wraps the icon without touching its layout, so any like control (the
// HeartButton below, the player's like pill) can share it. Driven by state
// transition, not entering/exiting props (safe under any parent's null gate).
export function LikeBurst({ liked, accent, size = 22, children }) {
  const reduced = useReducedMotion();
  const burst = useSharedValue(1); // 1 = finished/idle (everything hidden)
  const prev = useRef(liked);

  useEffect(() => {
    if (liked && !prev.current && !reduced) {
      burst.value = 0;
      burst.value = withTiming(1, { duration: 520, easing: EASE.enter });
    }
    prev.current = liked;
  }, [liked, reduced, burst]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: burst.value >= 1 ? 0 : (1 - burst.value) * 0.8,
    transform: [{ scale: 0.5 + burst.value * 1.3 }],
  }));

  return (
    <View style={styles.stage}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          {
            width: size * 1.7,
            height: size * 1.7,
            borderRadius: size,
            borderColor: accent,
          },
          ringStyle,
        ]}
      />
      {PARTICLES.map(p => (
        <BurstDot
          key={p.deg}
          particle={p}
          burst={burst}
          reach={size * 1.15}
          accent={accent}
        />
      ))}
      {children}
    </View>
  );
}

// One flung dot — its own component so the animated style is a proper
// top-level hook; all six still read the single shared burst progress.
function BurstDot({ particle, burst, reach, accent }) {
  const style = useAnimatedStyle(() => ({
    opacity: burst.value >= 1 ? 0 : 1 - burst.value,
    transform: [
      { translateX: particle.x * burst.value * reach },
      { translateY: particle.y * burst.value * reach },
      { scale: 1 - burst.value * 0.5 },
    ],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.dot, { backgroundColor: accent }, style]}
    />
  );
}

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
      // Liking lands with a deep squeeze and a hard overshoot; unliking is a
      // quiet dip — celebration belongs to the like, not the takeback.
      scale.value = liked
        ? withSequence(
            withTiming(0.8, { duration: DUR.press, easing: EASE.settle }),
            withSpring(1, { mass: 1, stiffness: 300, damping: 26 }),
          )
        : withSequence(
            withTiming(0.6, { duration: DUR.press, easing: EASE.settle }),
            withSpring(1, LIKE_SPRING),
          );
    }
    showToast(liked ? 'Removed from likes.' : 'Liked.');
    (liked ? unlike(trackId) : like(trackId)).catch(() => {
      showToast("Couldn't like — try again.");
    });
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={liked ? 'unlike' : 'like'}
      onPress={toggle}
      hitSlop={10}
    >
      <LikeBurst liked={liked} accent={accent} size={size}>
        <Animated.View style={pop}>
          <Icon
            name={liked ? 'heart-filled' : 'heart'}
            size={size}
            color={liked ? accent : color}
            strokeWidth={1.7}
          />
        </Animated.View>
      </LikeBurst>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    borderWidth: 1.5,
  },
  dot: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
  },
});
