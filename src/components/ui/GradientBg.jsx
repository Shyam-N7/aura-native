import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

// One gradient helper for every stage/scrim/backdrop. `stops` = [{ offset, color,
// opacity }]. Angle in degrees matching CSS linear-gradient (140deg ≈ web stages).
export function GradientBg({ stops, angle = 140, radial = false, style }) {
  const rad = ((angle - 90) * Math.PI) / 180;
  const x2 = 0.5 + Math.cos(rad) / 2;
  const y2 = 0.5 + Math.sin(rad) / 2;
  const x1 = 1 - x2;
  const y1 = 1 - y2;

  return (
    <Svg style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Defs>
        {radial ? (
          <RadialGradient id="g" cx="50%" cy="50%" r="70%">
            {stops.map((s, i) => (
              <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity ?? 1} />
            ))}
          </RadialGradient>
        ) : (
          <LinearGradient id="g" x1={x1} y1={y1} x2={x2} y2={y2}>
            {stops.map((s, i) => (
              <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity ?? 1} />
            ))}
          </LinearGradient>
        )}
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#g)" />
    </Svg>
  );
}
