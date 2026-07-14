import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Circle, ClipPath, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedProps,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SAMPLES = 80;

// Direct port of the web ProgressRibbon: a per-track seeded sine ribbon whose
// phase drifts at ~30Hz while playing; the accent stroke is clipped to
// progress and the thumb rides the wave. All motion runs on the UI thread.
export function ProgressRibbon({ progress = 0, playing, seed = 'x', accent, dim, height = 60, onSeek }) {
  const [width, setWidth] = useState(0);

  // Same seed hash as web (verbatim port incl. the bit ops): amp 0.16–0.39, freq 1.4–2.4.
  /* eslint-disable no-bitwise */
  let s = 0;
  for (const c of seed) {
    s = (s * 31 + c.charCodeAt(0)) & 0xffffffff;
  }
  const amp = ((s >>> 0) % 50) / 220 + 0.16;
  const freq = 1.4 + ((s >>> 4) % 40) / 40;
  /* eslint-enable no-bitwise */

  const phase = useSharedValue(0);
  const shownProgress = useSharedValue(progress);
  const drag = useSharedValue(-1); // -1 = not dragging

  // Smooth the 4Hz progress ticks; a live drag wins over playback.
  useEffect(() => {
    shownProgress.value = withTiming(progress, { duration: 260, easing: Easing.linear });
  }, [progress, shownProgress]);

  useFrameCallback((frame) => {
    'worklet';
    if (!playing) {
      return;
    }
    // ~30Hz like the web (each tick advances the wave one step).
    if (frame.timeSincePreviousFrame == null || frame.timeSincePreviousFrame >= 0) {
      phase.value = (phase.value + 0.044 * ((frame.timeSincePreviousFrame ?? 33) / 33)) % (Math.PI * 2);
    }
  }, playing);

  const effective = useDerivedValue(() =>
    drag.value >= 0 ? drag.value : Math.min(1, Math.max(0, shownProgress.value)),
  );

  const wavePath = useDerivedValue(() => {
    'worklet';
    if (width <= 0) {
      return 'M 0 0';
    }
    const pts = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const x = (i / SAMPLES) * width;
      const tt = (i / SAMPLES) * Math.PI * 2 * freq + phase.value;
      const env = Math.sin((i / SAMPLES) * Math.PI) * 0.7 + 0.3;
      const y = height / 2 + Math.sin(tt) * amp * height * env;
      pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return pts.join(' ');
  });

  const pathProps = useAnimatedProps(() => ({ d: wavePath.value }));
  const clipProps = useAnimatedProps(() => ({ width: Math.max(0, width * effective.value) }));
  const thumbProps = useAnimatedProps(() => {
    'worklet';
    const p = effective.value;
    const i = p * SAMPLES;
    const tt = (i / SAMPLES) * Math.PI * 2 * freq + phase.value;
    const env = Math.sin((i / SAMPLES) * Math.PI) * 0.7 + 0.3;
    return { cx: width * p, cy: height / 2 + Math.sin(tt) * amp * height * env };
  });

  const commit = (p) => onSeek?.(p);

  const pan = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .failOffsetY([-14, 14])
    .onBegin((e) => {
      'worklet';
      if (width > 0) {
        drag.value = Math.min(1, Math.max(0, e.x / width));
      }
    })
    .onUpdate((e) => {
      'worklet';
      if (width > 0) {
        drag.value = Math.min(1, Math.max(0, e.x / width));
      }
    })
    .onEnd(() => {
      'worklet';
      if (drag.value >= 0) {
        runOnJS(commit)(drag.value);
      }
    })
    .onFinalize(() => {
      'worklet';
      drag.value = -1;
    });

  const tap = Gesture.Tap().onEnd((e) => {
    'worklet';
    if (width > 0) {
      runOnJS(commit)(Math.min(1, Math.max(0, e.x / width)));
    }
  });

  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <View style={[styles.hit, { height }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <Svg width={width} height={height}>
            <Defs>
              <ClipPath id="ribbonClip">
                <AnimatedRect x="0" y="0" height={height} animatedProps={clipProps} />
              </ClipPath>
              <LinearGradient id="ribbonGrad" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={accent} stopOpacity="0.85" />
                <Stop offset="1" stopColor={accent} stopOpacity="1" />
              </LinearGradient>
            </Defs>
            <AnimatedPath
              animatedProps={pathProps}
              stroke={dim}
              strokeWidth={1.4}
              fill="none"
              strokeLinecap="round"
            />
            <AnimatedPath
              animatedProps={pathProps}
              stroke="url(#ribbonGrad)"
              strokeWidth={2.2}
              fill="none"
              strokeLinecap="round"
              clipPath="url(#ribbonClip)"
            />
            <AnimatedCircle animatedProps={thumbProps} r={9} fill={accent} opacity={0.18} />
            <AnimatedCircle animatedProps={thumbProps} r={4} fill={accent} />
          </Svg>
        )}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  hit: { justifyContent: 'center' },
});
