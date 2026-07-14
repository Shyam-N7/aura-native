import React from 'react';
import Svg, { Path } from 'react-native-svg';

// One-file stroke icon set on a 24x24 grid. `fill: true` entries (play) render
// as solid shapes; everything else is round-capped strokes.
const ICONS = {
  home: { d: 'M3 10.5 12 3l9 7.5 M5 9.5 V21 h5 v-6 h4 v6 h5 V9.5' },
  search: {
    d: 'M11 4 a7 7 0 1 0 0 14 a7 7 0 1 0 0 -14 M21 21 l-4.35 -4.35',
  },
  chat: {
    d: 'M4 6 a2 2 0 0 1 2 -2 h12 a2 2 0 0 1 2 2 v8 a2 2 0 0 1 -2 2 H9 l-5 4 V6 Z',
  },
  user: {
    d: 'M12 4 a4 4 0 1 0 0 8 a4 4 0 1 0 0 -8 M4 21 c1.5 -4 5 -5.5 8 -5.5 s6.5 1.5 8 5.5',
  },
  play: { d: 'M8 5 v14 l11 -7 Z', fill: true },
  pause: { d: 'M8 5 v14 M16 5 v14', thick: true },
  next: { d: 'M5 6 v12 l9 -6 Z M19 5 v14', thick: true },
  prev: { d: 'M19 6 v12 l-9 -6 Z M5 5 v14', thick: true },
  close: { d: 'M6 6 l12 12 M18 6 L6 18' },
  shuffle: {
    d: 'M16 4 h4 v4 M4 20 L20 4 M20 16 v4 h-4 M14 14 l6 6 M4 4 l6 6',
  },
  repeat: {
    d: 'M17 2 l4 4 -4 4 M3 12 V10 a4 4 0 0 1 4 -4 h14 M7 22 l-4 -4 4 -4 M21 12 v2 a4 4 0 0 1 -4 4 H3',
  },
  'repeat-one': {
    d: 'M17 2 l4 4 -4 4 M3 12 V10 a4 4 0 0 1 4 -4 h14 M7 22 l-4 -4 4 -4 M21 12 v2 a4 4 0 0 1 -4 4 H3 M11 10.5 l1.5 -1 v5',
  },
  'chevron-down': { d: 'M6 9 l6 6 6 -6' },
  theme: { d: 'M12 4 a8 8 0 1 0 0 16 a8 8 0 1 0 0 -16 M12 4 v16' },
};

export function Icon({ name, size = 24, color = '#000', strokeWidth = 1.8 }) {
  const icon = ICONS[name];
  if (!icon) {
    return null;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d={icon.d}
        stroke={icon.fill ? 'none' : color}
        strokeWidth={icon.fill ? 0 : icon.thick ? strokeWidth + 0.6 : strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={icon.fill ? color : 'none'}
      />
    </Svg>
  );
}
