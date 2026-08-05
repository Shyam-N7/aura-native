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

// The one sampler every stroke in this file draws through: the track, the
// played stretch and the loaded-ahead stretch all trace the SAME sine, so they
// must agree to the pixel or they visibly separate.
//
// `from`/`to` are sample indices and may be fractional, so a stretch can start
// and stop mid-sample (the played one ends exactly under the thumb; the
// buffered one starts exactly where the played one stopped).
export function ribbonPath(from, to, phase, span, height, amp, freq) {
  'worklet';
  if (span <= 0 || to < from) {
    return 'M 0 0';
  }
  const pts = [];
  const at = i => {
    const x = PAD + (i / SAMPLES) * span;
    const tt = (i / SAMPLES) * Math.PI * 2 * freq + phase;
    const env = Math.sin((i / SAMPLES) * Math.PI) * 0.7 + 0.3;
    const y = height / 2 + Math.sin(tt) * amp * height * env;
    return `${pts.length === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  };
  if (from > Math.floor(from)) {
    pts.push(at(from));
  }
  for (let i = Math.ceil(from); i <= to; i++) {
    pts.push(at(i));
  }
  // Fractional tail, or a zero-length stretch — the latter still emits its
  // second point so the round cap draws a dot rather than nothing.
  if (to > Math.floor(to) || pts.length < 2) {
    pts.push(at(to));
  }
  return pts.join(' ');
}

// Direct port of the web ProgressRibbon: a per-track seeded sine ribbon whose
// phase drifts at ~30Hz while playing; the accent stroke is clipped to
// progress and the thumb rides the wave. All motion runs on the UI thread.
// variant 'line' flattens the SAME machinery to a straight bar (amplitude 0,
// wave clock parked); onScrub reports the dragged position in WHOLE SECONDS
// (-1 = not scrubbing) so the time labels can follow the finger without a
// 60fps JS storm.
export function ProgressRibbon({
  progress = 0,
  // How far ahead the stream has actually loaded, 0..1. Drawn ON the wave,
  // as a third stroke through the same sampler.
  //
  // This used to be a flat rule on the centreline, on the theory that the
  // centreline is where the wave crosses so it would read as part of the
  // ribbon. It doesn't: it cuts straight across the crests and reads as a
  // separate bar laid over the ribbon. The cost of doing it properly is much
  // smaller than the old comment feared, because this stroke only spans
  // playhead → buffered head — everything behind the playhead is already
  // painted over by the accent stroke, so there is nothing to draw there.
  // Typical extra: a handful of points per sampler tick, not a second ~80.
  buffered = 0,
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
  // 30Hz-sampled fill. The path builders must NOT read shownProgress
  // directly: the 4Hz progress poll starts a 260ms withTiming every ~250ms,
  // so shownProgress animates continuously through playback and the ~80-point
  // path rebuilds (the heaviest per-frame worker in the app) ran at the full
  // display rate — parking the wave phase alone changed nothing.
  const fill = useSharedValue(Math.min(1, Math.max(0, progress)));
  const acc = useSharedValue(1000); // large: first active frame commits now
  const waveActive = useSharedValue(false);
  // The frame callback's closure registers ONCE at mount — a bare `variant`
  // in the worklet is frozen at its mount value (the same trap the old
  // `playing` comment below describes), so it rides a shared value.
  const isLine = useSharedValue(variant === 'line');
  useEffect(() => {
    isLine.value = variant === 'line';
  }, [variant, isLine]);

  // Smooth the 4Hz progress ticks; a live drag wins over playback.
  useEffect(() => {
    shownProgress.value = withTiming(progress, {
      duration: 260,
      easing: Easing.linear,
    });
  }, [progress, shownProgress]);

  // Buffered head. Eased over a longer window than the playhead because it
  // advances in CHUNKS — ExoPlayer loads a block, sits at maxBuffer, then
  // loads again — and stepping that raw would read as a twitch rather than
  // as filling.
  const bufferedFill = useSharedValue(Math.min(1, Math.max(0, buffered)));
  useEffect(() => {
    bufferedFill.value = withTiming(Math.min(1, Math.max(0, buffered)), {
      duration: 420,
      easing: Easing.linear,
    });
  }, [buffered, bufferedFill]);

  // useFrameCallback reads its autostart arg ONCE at mount and registers the
  // worklet's closure ONCE — a bare `playing` in either place is frozen at its
  // mount value (opened-while-paused = wave never moves; opened-while-playing
  // = 60fps loop through every pause). setActive() is the live control.
  //
  // The callback is the single ~30Hz sampler for everything the paths read:
  // it advances the wave phase AND commits the fill, so between ticks nothing
  // re-derives and the svg strings rebuild at 30Hz instead of 60-120.
  const wave = useFrameCallback(frame => {
    'worklet';
    acc.value += frame.timeSincePreviousFrame ?? 33;
    if (acc.value < 30) {
      return;
    }
    if (!isLine.value) {
      // acc is true elapsed time, so the wave speed stays exactly the web's.
      phase.value =
        (phase.value + 0.044 * (acc.value / 33)) % (Math.PI * 2);
    }
    const p =
      drag.value >= 0
        ? drag.value
        : Math.min(1, Math.max(0, shownProgress.value));
    if (p !== fill.value) {
      fill.value = p;
    }
    acc.value = 0;
  }, playing);
  // Backgrounded (screen off, still playing) it MUST park: ColorOS keeps the
  // frame clock alive there, and this loop was a main feeder of the
  // reports/10 native-heap leak. The line variant runs the callback too —
  // its fill also needs the 30Hz sampling — but skips the phase write.
  const appActive = useAppActive();
  useEffect(() => {
    const on = playing && appActive;
    waveActive.value = on;
    wave.setActive(on);
  }, [playing, appActive, wave, waveActive]);

  // With the sampler parked (paused), seeks and track changes still move
  // shownProgress — mirror them into the fill at their own (bounded) rate.
  useAnimatedReaction(
    () => shownProgress.value,
    v => {
      if (!waveActive.value) {
        const p = drag.value >= 0 ? drag.value : Math.min(1, Math.max(0, v));
        if (p !== fill.value) {
          fill.value = p;
        }
      }
    },
    [],
  );

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

  const span = Math.max(0, width - PAD * 2);

  const wavePath = useDerivedValue(() => {
    'worklet';
    return ribbonPath(0, SAMPLES, phase.value, span, height, amp, freq);
  });

  // The completed stretch is its own live path up to the progress point
  // (fractional last sample so it ends exactly under the thumb). The web
  // clipped one path instead, but an ANIMATED clip rect never re-evaluates
  // on this rn-svg/Fabric combo — the fill was invisible in the field.
  const donePath = useDerivedValue(() => {
    'worklet';
    // A live drag tracks the finger at full rate; playback fills at the
    // sampler's 30Hz (sub-pixel steps — indistinguishable).
    const end = (drag.value >= 0 ? drag.value : fill.value) * SAMPLES;
    return ribbonPath(0, end, phase.value, span, height, amp, freq);
  });

  // Loaded-ahead stretch: playhead → buffered head, on the same curve. Starts
  // at the playhead rather than at 0 because the accent stroke already covers
  // everything behind it — drawing that part would be invisible work. When the
  // buffer falls behind the playhead (a stall) `to < from` and this collapses
  // to an empty path, which is the honest picture.
  const bufferedPath = useDerivedValue(() => {
    'worklet';
    const start = (drag.value >= 0 ? drag.value : fill.value) * SAMPLES;
    const end = Math.min(1, Math.max(0, bufferedFill.value)) * SAMPLES;
    return ribbonPath(start, end, phase.value, span, height, amp, freq);
  });

  const pathProps = useAnimatedProps(() => ({ d: wavePath.value }));
  const doneProps = useAnimatedProps(() => ({ d: donePath.value }));
  const bufferedProps = useAnimatedProps(() => ({ d: bufferedPath.value }));
  const thumbProps = useAnimatedProps(() => {
    'worklet';
    const p = drag.value >= 0 ? drag.value : fill.value;
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
        fill.value = drag.value;
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
      fill.value = p;
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
            {/* Loaded-ahead stretch, riding the wave. Drawn before the played
                stroke so the accent always wins where they overlap, and a
                touch heavier/brighter than the 0.1 track so "loaded" is
                legible against "not loaded" without competing with the
                accent. */}
            {buffered > 0 && (
              <AnimatedPath
                animatedProps={bufferedProps}
                stroke={dim}
                strokeOpacity={0.28}
                strokeWidth={1.8}
                fill="none"
                strokeLinecap="round"
              />
            )}
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
