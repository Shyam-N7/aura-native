import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';
import { MOOD_COLOR, blendHex } from '../../lib/bridges';
import { fonts, label } from '../../theme/tokens';

// The living itinerary: the bridge arc where every step is the actual album
// art it will play, a one-word stage label under each rung, and the narrative
// beneath. Three states: tracks → art-filled journey · loading → faded dots ·
// neither → plain interpolated dots (pre-curation preview). Ported from web
// BridgeItinerary.jsx; the vector arc/dots/labels are rn-svg, the album art is
// overlaid as RN Images (robust vs. SVG <Image>+clipPath), and the web's
// oklab color-mix arc becomes a solid mid-blend stroke (gradient-url strokes
// are unreliable on this rn-svg/Fabric build).
const LOW_MOODS = ['sad', 'stressed', 'restless', 'tired', 'lonely'];
const W = 320;
const H = 84;
const BASE_Y = 32;
const AMP = 9;
const X0 = 16;
const X1 = W - 16;

export function BridgeItinerary({
  bridge,
  tracks = null,
  narrative = '',
  loading = false,
  cta = null,
  t,
}) {
  const [w, setW] = useState(0);
  const fromC = MOOD_COLOR[bridge.from] || '#7a3a1f';
  const toC = MOOD_COLOR[bridge.to] || '#7a3a1f';
  const dip = LOW_MOODS.includes(bridge.from) ? 1 : -1;
  const n = tracks?.length || bridge.steps;
  const cy1 = BASE_Y + dip * AMP;
  const cy2 = BASE_Y - dip * AMP;
  const yAt = tt =>
    (1 - tt) ** 3 * BASE_Y +
    3 * (1 - tt) ** 2 * tt * cy1 +
    3 * (1 - tt) * tt ** 2 * cy2 +
    tt ** 3 * BASE_Y;
  const scale = w / W;
  const arcColor = blendHex(fromC, toC, 0.5);

  const steps = Array.from({ length: n }).map((_, i) => {
    const tt = n === 1 ? 0 : i / (n - 1);
    const x = X0 + tt * (X1 - X0);
    const y = yAt(tt);
    const isEnd = i === 0 || i === n - 1;
    const col = i === 0 ? fromC : i === n - 1 ? toC : blendHex(fromC, toC, tt);
    return { i, tt, x, y, isEnd, col, track: tracks?.[i] ?? null };
  });

  return (
    <View onLayout={e => setW(e.nativeEvent.layout.width)}>
      <View style={styles.moods}>
        <Text style={[styles.mood, { color: fromC }]}>{bridge.from}</Text>
        <Text style={[styles.mood, { color: toC }]}>{bridge.to}</Text>
      </View>

      {w > 0 && (
        <View style={{ height: H * scale }}>
          <Svg width={w} height={H * scale} viewBox={`0 0 ${W} ${H}`}>
            <Line
              x1={X0}
              x2={X1}
              y1={BASE_Y}
              y2={BASE_Y}
              stroke={t.line}
              strokeWidth={0.6}
              strokeDasharray="1.5 3"
            />
            <Path
              d={`M${X0} ${BASE_Y} C ${X0 + 96} ${cy1}, ${X1 - 96} ${cy2}, ${X1} ${BASE_Y}`}
              stroke={arcColor}
              strokeWidth={1.8}
              fill="none"
              strokeLinecap="round"
            />
            {steps.map(s => (
              <G key={s.i}>
                {s.isEnd && (
                  <Circle
                    cx={s.x}
                    cy={s.y}
                    r={s.track ? 14 : 5}
                    fill={s.col}
                    opacity={0.18}
                  />
                )}
                {s.track ? (
                  <Circle
                    cx={s.x}
                    cy={s.y}
                    r={11}
                    fill="none"
                    stroke={s.col}
                    strokeWidth={1.1}
                  />
                ) : (
                  <Circle
                    cx={s.x}
                    cy={s.y}
                    r={s.isEnd ? 3 : 2}
                    fill={s.col}
                    opacity={loading ? 0.4 : 1}
                  />
                )}
                {!!s.track?.stepLabel && (
                  <SvgText
                    x={s.i === 0 ? X0 - 12 : s.i === n - 1 ? X1 + 12 : s.x}
                    y={s.y + 21}
                    textAnchor={
                      s.i === 0 ? 'start' : s.i === n - 1 ? 'end' : 'middle'
                    }
                    fontSize={7.5}
                    fontFamily={fonts.medium}
                    fill={t.inkSoft}
                  >
                    {s.track.stepLabel}
                  </SvgText>
                )}
              </G>
            ))}
          </Svg>

          {steps
            .filter(s => s.track?.imageUrl)
            .map(s => {
              const r = 11 * scale;
              return (
                <Image
                  key={s.i}
                  source={{ uri: s.track.imageUrl }}
                  style={[
                    styles.art,
                    {
                      left: s.x * scale - r,
                      top: s.y * scale - r,
                      width: r * 2,
                      height: r * 2,
                      borderRadius: r,
                    },
                  ]}
                />
              );
            })}
        </View>
      )}

      {loading && (
        <Text style={[label(9), styles.state, { color: t.inkFaint }]}>
          curating your bridge
        </Text>
      )}
      {!loading && !!narrative && (
        <Text style={[styles.narrative, { color: t.inkSoft }]}>{narrative}</Text>
      )}
      {!loading && cta && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={cta.label}
          onPress={cta.onPress}
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
        >
          <Text style={[label(9.5), { color: t.accent }]}>{cta.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  moods: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  mood: {
    fontFamily: fonts.semibold,
    fontSize: 17,
    letterSpacing: -0.2,
  },
  art: { position: 'absolute' },
  state: { marginTop: 6 },
  narrative: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  cta: { marginTop: 12, alignSelf: 'flex-start' },
  pressed: { opacity: 0.6 },
});
