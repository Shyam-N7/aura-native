import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { Glass } from '../ui/Glass';
import { PressScale } from '../ui/PressScale';
import { Icon } from '../Icon';
import { TrackArt } from '../TrackRow';
import { useTheme } from '../../theme/ThemeContext';
import { usePlayer } from '../../playback/PlayerContext';
import { usePlaybackProgress } from '../../hooks/usePlaybackProgress';
import { glass } from '../../theme/tokens';
import { DUR, EASE, PRESS } from '../../theme/motion';

export const BEAD_SIZE = 52;
const RING_R = 24.75;
const RING_C = 2 * Math.PI * RING_R;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// The web dock's now-playing bead: a 52px glass disc that buds off the capsule —
// progress ring, circular art, and a small play/pause disc. Tapping the body
// opens the player.
export function Bead() {
  const { t } = useTheme();
  const player = usePlayer();
  const { progress } = usePlaybackProgress();
  const reduced = useReducedMotion();

  // Smooth the 4Hz progress ticks into a continuous ring sweep.
  const ring = useSharedValue(0);
  useEffect(() => {
    ring.value = withTiming(progress || 0, {
      duration: 260,
      easing: Easing.linear,
    });
  }, [progress, ring]);

  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: RING_C * (1 - ring.value),
  }));

  // Bud-in: the bead grows out of the capsule's left edge (web transform-origin 84%/50%).
  const bud = useSharedValue(reduced ? 1 : 0.2);
  useEffect(() => {
    bud.value = withTiming(1, { duration: DUR.bud, easing: EASE.settle });
  }, [bud]);
  const budStyle = useAnimatedStyle(() => ({
    opacity: 0.4 + bud.value * 0.6,
    transform: [{ scale: bud.value }],
  }));

  const track = player.current;
  if (!track) {
    return null;
  }

  const open = () => player.ui?.openPlayer?.();

  return (
    <Animated.View style={[styles.box, budStyle]}>
      <PressScale
        accessibilityRole="button"
        accessibilityLabel="open player"
        onPress={open}
      >
        <Glass radius={BEAD_SIZE / 2} style={styles.disc}>
          <View style={styles.art}>
            <TrackArt track={track} size={BEAD_SIZE - 8} radius={999} />
          </View>
          <Svg
            width={BEAD_SIZE}
            height={BEAD_SIZE}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          >
            {/* Solid stroke + strokeOpacity = t.line without rn-svg's broken
                rgba() handling (alpha renders opaque on Android). */}
            <Circle
              cx={BEAD_SIZE / 2}
              cy={BEAD_SIZE / 2}
              r={RING_R}
              stroke={t.ink}
              strokeOpacity={0.1}
              strokeWidth={2.5}
              fill="none"
            />
            <AnimatedCircle
              cx={BEAD_SIZE / 2}
              cy={BEAD_SIZE / 2}
              r={RING_R}
              stroke={t.accent}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeDasharray={`${RING_C} ${RING_C}`}
              animatedProps={ringProps}
              fill="none"
              transform={`rotate(-90 ${BEAD_SIZE / 2} ${BEAD_SIZE / 2})`}
            />
          </Svg>
        </Glass>
      </PressScale>
      <PressScale
        to={PRESS.disc}
        accessibilityRole="button"
        accessibilityLabel={player.isPlaying ? 'pause' : 'play'}
        onPress={player.togglePlay}
        hitSlop={8}
        style={[
          styles.toggle,
          { backgroundColor: glass.discBg, borderColor: glass.discBorder },
        ]}
      >
        <Icon
          name={player.isPlaying ? 'pause' : 'play'}
          size={11}
          color="#fff"
        />
      </PressScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Buds out of the capsule's left edge (web transform-origin 84%/50%).
  box: { width: BEAD_SIZE, height: BEAD_SIZE, transformOrigin: '84% 50%' },
  disc: {
    width: BEAD_SIZE,
    height: BEAD_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  art: { position: 'absolute', left: 4, top: 4 },
  toggle: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
