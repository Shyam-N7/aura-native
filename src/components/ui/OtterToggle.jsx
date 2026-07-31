import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { label as labelType } from '../../theme/tokens';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedRect = Animated.createAnimatedComponent(Rect);

// The uiverse "friendly-otter-40" switch (njesenberger), recreated in the
// app's own colors: a pinched-waist track, an I bar and an O ring on the
// ends, and a knob that travels the length of it. The original's gooey knob
// is an SVG filter chain (feGaussianBlur + feColorMatrix) — a class
// rn-svg/Fabric can't be trusted with — so the liquid read is rebuilt as
// squash-and-stretch: the knob thins and lengthens mid-flight, then lands
// round on the far end. All geometry is the source's own 292×142 viewBox.
const TRACK =
  'M71 142C31.7878 142 0 110.212 0 71C0 31.7878 31.7878 0 71 0C110.212 0 ' +
  '119 30 146 30C173 30 182 0 221 0C260 0 292 31.7878 292 71C292 110.212 ' +
  '260.212 142 221 142C181.788 142 173 112 146 112C119 112 110.212 142 71 142Z';
const RING =
  'M221 91C232.046 91 241 82.0457 241 71C241 59.9543 232.046 51 221 51C' +
  '209.954 51 201 59.9543 201 71C201 82.0457 209.954 91 221 91ZM221 103C' +
  '238.673 103 253 88.6731 253 71C253 53.3269 238.673 39 221 39C203.327 39 ' +
  '189 53.3269 189 71C189 88.6731 203.327 103 221 103Z';

const DUR = 450;

export function OtterToggle({ value, onPress, height = 30, label }) {
  const { t } = useTheme();
  const reduced = useReducedMotion();
  const width = (height * 292) / 142;

  // 0 = off (knob left), 1 = on (knob right). Colors and knob geometry all
  // derive from this one value on the UI thread.
  const p = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    p.value = reduced
      ? value
        ? 1
        : 0
      : withTiming(value ? 1 : 0, {
          duration: DUR,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
        });
  }, [value, reduced, p]);

  // Off = the house switch's quiet register (hairline on bg); on = accent.
  const trackProps = useAnimatedProps(() => ({
    fill: interpolateColor(p.value, [0, 1], [t.line, t.accent]),
  }));

  // The knob: a circle at either end that squashes into a longer, thinner
  // capsule mid-travel — sin(pπ) is the stretch envelope.
  const knobProps = useAnimatedProps(() => {
    const s = Math.sin(p.value * Math.PI);
    const w = 114 + 46 * s;
    const h = 114 - 52 * s;
    return {
      x: 71 + 150 * p.value - w / 2,
      y: (142 - h) / 2,
      width: w,
      height: h,
      rx: h / 2,
    };
  });

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label ?? 'toggle'}
      accessibilityState={{ checked: !!value }}
      onPress={onPress}
      hitSlop={10}
      style={styles.wrap}
    >
      <Svg width={width} height={height} viewBox="0 0 292 142">
        <AnimatedPath animatedProps={trackProps} d={TRACK} />
        {/* the I (on) — revealed on the accent track once the knob leaves */}
        <Rect x={64} y={39} width={12} height={64} rx={6} fill={t.bg} />
        {/* the O (off) — a quiet ring while the switch rests off */}
        <Path d={RING} fillRule="evenodd" fill={t.bg} fillOpacity={0.55} />
        <AnimatedRect animatedProps={knobProps} fill={t.bg} />
      </Svg>
      {!!label && (
        <Text style={[labelType(8), styles.label, { color: t.inkFaint }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 5 },
  // Hosts may cap the column width (home's corner stack) — a wrapped label
  // must centre its second line, not rag left.
  label: { textAlign: 'center' },
});
