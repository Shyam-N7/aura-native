import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useAppActive } from '../../hooks/useAppActive';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SAMPLES = 80;
// The wave is inset from the canvas edges so the thumb (r9 halo) and the
// round line caps draw whole at 0% and 100% instead of getting chopped by
// the svg bounds (field report: the start looked squared-off).
const PAD = 10;

// Direct port of the web ProgressRibbon: a per-track seeded sine ribbon whose
// phase drifts at ~30Hz while playing; the accent stroke is clipped to
// progress and the thumb rides the wave. All motion runs on the UI thread.
// variant 'line' flattens the SAME machinery to a straight bar (amplitude 0,
// wave clock parked); onScrub reports the dragged position in WHOLE SECONDS
// (-1 = not scrubbing) so the time labels can follow the finger without a
// 60fps JS storm.
export function ProgressRibbon({
  progress = 0,
  playing,
  seed = 'x',
  accent,
  dim,
  height = 60,
  variant = 'wave',
  durationSec = 0,
  onSeek,
  onScrub,
}) {
  const [width, setWidth] = useState(0);

  // Same seed hash as web (verbatim port incl. the bit ops): amp 0.16–0.39, freq 1.4–2.4.
  /* eslint-disable no-bitwise */
  let s = 0;
  for (const c of seed) {
    s = (s * 31 + c.charCodeAt(0)) & 0xffffffff;
  }
  const amp = variant === 'line' ? 0 : ((s >>> 0) % 50) / 220 + 0.16;
  const freq = 1.4 + ((s >>> 4) % 40) / 40;
  /* eslint-enable no-bitwise */

  const phase = useSharedValue(0);
  const shownProgress = useSharedValue(progress);
  const drag = useSharedValue(-1); // -1 = not dragging

  // Smooth the 4Hz progress ticks; a live drag wins over playback.
  useEffect(() => {
    shownProgress.value = withTiming(progress, {
      duration: 260,
      easing: Easing.linear,
    });
  }, [progress, shownProgress]);

  // useFrameCallback reads its autostart arg ONCE at mount and registers the
  // worklet's closure ONCE — a bare `playing` in either place is frozen at its
  // mount value (opened-while-paused = wave never moves; opened-while-playing
  // = 60fps loop through every pause). setActive() is the live control.
  const wave = useFrameCallback(frame => {
    'worklet';
    // ~30Hz like the web (each tick advances the wave one step).
    if (
      frame.timeSincePreviousFrame == null ||
      frame.timeSincePreviousFrame >= 0
    ) {
      phase.value =
        (phase.value + 0.044 * ((frame.timeSincePreviousFrame ?? 33) / 33)) %
        (Math.PI * 2);
    }
  }, playing);
  // Each tick rebuilds two ~80-point path strings on the worklet runtime and
  // commits them as svg props — the single heaviest per-frame worker in the
  // app, so backgrounded (screen off, still playing) it MUST park: ColorOS
  // keeps the frame clock alive there, and this loop was a main feeder of the
  // reports/10 native-heap leak.
  const appActive = useAppActive();
  useEffect(() => {
    // A flat line has no wave to advance — park the frame clock entirely.
    wave.setActive(playing && variant !== 'line' && appActive);
  }, [playing, variant, appActive, wave]);

  // Scrub reporter: fires only when the DISPLAYED second changes (not per
  // frame), and once with -1 when the finger lifts.
  const notifyScrub = sec => onScrub?.(sec);
  useAnimatedReaction(
    () =>
      drag.value >= 0 && durationSec > 0
        ? Math.floor(drag.value * durationSec)
        : -1,
    (sec, prev) => {
      if (sec !== prev && prev !== null) {
        runOnJS(notifyScrub)(sec);
      }
    },
    [durationSec],
  );

  const effective = useDerivedValue(() =>
    drag.value >= 0
      ? drag.value
      : Math.min(1, Math.max(0, shownProgress.value)),
  );

  const span = Math.max(0, width - PAD * 2);

  const wavePath = useDerivedValue(() => {
    'worklet';
    if (span <= 0) {
      return 'M 0 0';
    }
    const pts = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const x = PAD + (i / SAMPLES) * span;
      const tt = (i / SAMPLES) * Math.PI * 2 * freq + phase.value;
      const env = Math.sin((i / SAMPLES) * Math.PI) * 0.7 + 0.3;
      const y = height / 2 + Math.sin(tt) * amp * height * env;
      pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return pts.join(' ');
  });

  // The completed stretch is its own live path up to the progress point
  // (fractional last sample so it ends exactly under the thumb). The web
  // clipped one path instead, but an ANIMATED clip rect never re-evaluates
  // on this rn-svg/Fabric combo — the fill was invisible in the field.
  const donePath = useDerivedValue(() => {
    'worklet';
    if (span <= 0) {
      return 'M 0 0';
    }
    const end = effective.value * SAMPLES;
    const pts = [];
    for (let i = 0; i <= end; i++) {
      const x = PAD + (i / SAMPLES) * span;
      const tt = (i / SAMPLES) * Math.PI * 2 * freq + phase.value;
      const env = Math.sin((i / SAMPLES) * Math.PI) * 0.7 + 0.3;
      const y = height / 2 + Math.sin(tt) * amp * height * env;
      pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    if (end > Math.floor(end) || end === 0) {
      const x = PAD + (end / SAMPLES) * span;
      const tt = (end / SAMPLES) * Math.PI * 2 * freq + phase.value;
      const env = Math.sin((end / SAMPLES) * Math.PI) * 0.7 + 0.3;
      const y = height / 2 + Math.sin(tt) * amp * height * env;
      pts.push(`${pts.length === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return pts.join(' ');
  });

  const pathProps = useAnimatedProps(() => ({ d: wavePath.value }));
  const doneProps = useAnimatedProps(() => ({ d: donePath.value }));
  const thumbProps = useAnimatedProps(() => {
    'worklet';
    const p = effective.value;
    const i = p * SAMPLES;
    const tt = (i / SAMPLES) * Math.PI * 2 * freq + phase.value;
    const env = Math.sin((i / SAMPLES) * Math.PI) * 0.7 + 0.3;
    return {
      cx: PAD + span * p,
      cy: height / 2 + Math.sin(tt) * amp * height * env,
    };
  });

  const commit = p => onSeek?.(p);

  const pan = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .failOffsetY([-14, 14])
    .onBegin(e => {
      'worklet';
      if (span > 0) {
        drag.value = Math.min(1, Math.max(0, (e.x - PAD) / span));
      }
    })
    .onUpdate(e => {
      'worklet';
      if (span > 0) {
        drag.value = Math.min(1, Math.max(0, (e.x - PAD) / span));
      }
    })
    .onEnd(() => {
      'worklet';
      if (drag.value >= 0) {
        // Hold the sought position (killing any in-flight smoothing) so the
        // fill doesn't flash back to the old progress while the engine seeks.
        shownProgress.value = drag.value;
        runOnJS(commit)(drag.value);
      }
    })
    .onFinalize(() => {
      'worklet';
      drag.value = -1;
    });

  const tap = Gesture.Tap().onEnd(e => {
    'worklet';
    if (span > 0) {
      const p = Math.min(1, Math.max(0, (e.x - PAD) / span));
      shownProgress.value = p;
      runOnJS(commit)(p);
    }
  });

  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <View
        style={[styles.hit, { height }]}
        onLayout={e => setWidth(e.nativeEvent.layout.width)}
      >
        {width > 0 && (
          <Svg width={width} height={height}>
            {/* dim arrives as a solid ink color; the web's hairline register is
                ink at 10% — kept as strokeOpacity because rn-svg renders rgba()
                strings opaque on Android. */}
            <AnimatedPath
              animatedProps={pathProps}
              stroke={dim}
              strokeOpacity={0.1}
              strokeWidth={1.4}
              fill="none"
              strokeLinecap="round"
            />
            <AnimatedPath
              animatedProps={doneProps}
              stroke={accent}
              strokeWidth={2.2}
              fill="none"
              strokeLinecap="round"
            />
            <AnimatedCircle
              animatedProps={thumbProps}
              r={9}
              fill={accent}
              opacity={0.18}
            />
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
