import React from 'react';
import Svg, { Path } from 'react-native-svg';

// One-file stroke icon set on a 24x24 grid. `fill: true` entries (play) render
// as solid shapes; everything else is round-capped strokes.
const HEART_D =
  'M12 20.5 C 5.4 15.2 3 12.2 3 8.9 a4.6 4.6 0 0 1 9 -1.4 a4.6 4.6 0 0 1 9 1.4 c0 3.3 -2.4 6.3 -9 11.6 Z';

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
  'chevron-left': { d: 'M15 5 l-7 7 7 7' },
  'chevron-right': { d: 'M9 5 l7 7 -7 7' },
  // Round line caps turn zero-length strokes into the ⋯ overflow dots.
  dots: { d: 'M12 5 v0.01 M12 12 v0.01 M12 19 v0.01', thick: true },
  // 6-dot drag grip (two columns of three).
  grip: {
    d: 'M9 6 v0.01 M9 12 v0.01 M9 18 v0.01 M15 6 v0.01 M15 12 v0.01 M15 18 v0.01',
    thick: true,
  },
  plus: { d: 'M12 5 v14 M5 12 h14' },
  // share (tray with the arrow leaving it) — track/moment/lyric share rows.
  share: {
    d: 'M4 12 v7 a2 2 0 0 0 2 2 h12 a2 2 0 0 0 2 -2 v-7 M16 6 l-4 -4 -4 4 M12 2 v13',
  },
  'queue-add': { d: 'M4 6 h16 M4 12 h16 M4 18 h7 M17.5 15 v6 M14.5 18 h6' },
  heart: { d: HEART_D },
  'heart-filled': { d: HEART_D, fill: true },
  // Three bars at different heights — a sound-level / audio-quality meter.
  quality: { d: 'M6 16 V11 M12 16 V6 M18 16 V13', thick: true },
  // Toothed cog (not radiating spokes — spokes read as a sun and get mistaken
  // for the theme toggle). Ported from the web settings-shelf peek.
  cog: {
    d: 'M12 9 a3 3 0 1 0 0 6 a3 3 0 1 0 0 -6 M12.22 2 h-.44 a2 2 0 0 0 -2 2 v.18 a2 2 0 0 1 -1 1.73 l-.43.25 a2 2 0 0 1 -2 0 l-.15 -.08 a2 2 0 0 0 -2.73.73 l-.22.38 a2 2 0 0 0 .73 2.73 l.15.1 a2 2 0 0 1 1 1.72 v.51 a2 2 0 0 1 -1 1.74 l-.15.09 a2 2 0 0 0 -.73 2.73 l.22.38 a2 2 0 0 0 2.73.73 l.15 -.08 a2 2 0 0 1 2 0 l.43.25 a2 2 0 0 1 1 1.73 V20 a2 2 0 0 0 2 2 h.44 a2 2 0 0 0 2 -2 v-.18 a2 2 0 0 1 1 -1.73 l.43 -.25 a2 2 0 0 1 2 0 l.15.08 a2 2 0 0 0 2.73 -.73 l.22 -.39 a2 2 0 0 0 -.73 -2.73 l-.15 -.08 a2 2 0 0 1 -1 -1.74 v-.5 a2 2 0 0 1 1 -1.74 l.15 -.09 a2 2 0 0 0 .73 -2.73 l-.22 -.38 a2 2 0 0 0 -2.73 -.73 l-.15.08 a2 2 0 0 1 -2 0 l-.43 -.25 a2 2 0 0 1 -1 -1.73 V4 a2 2 0 0 0 -2 -2 Z',
  },
  // Playlist visibility states — lock (private), two people (invited-only),
  // globe (public link), worn by the share chip like the web VIS_ICONs.
  lock: {
    d: 'M6 11 h12 v9 H6 Z M9 11 V8 a3 3 0 0 1 6 0 v3',
  },
  people: {
    d: 'M9 4.5 a3.2 3.2 0 1 0 0 6.4 a3.2 3.2 0 1 0 0 -6.4 M3 20 c1.2 -3.4 3.8 -4.8 6 -4.8 s4.8 1.4 6 4.8 M15.8 5 a3.2 3.2 0 0 1 0 5.6 M16.8 15.6 c2.2 0.5 3.6 1.9 4 4.4',
  },
  globe: {
    d: 'M12 3 a9 9 0 1 0 0 18 a9 9 0 1 0 0 -18 M3 12 h18 M12 3 c3.2 3.8 3.2 14.2 0 18 M12 3 c-3.2 3.8 -3.2 14.2 0 18',
  },
  // Theme-cycle glyphs — one per theme, the button always wears the active one.
  sun: {
    d: 'M12 8 a4 4 0 1 0 0 8 a4 4 0 1 0 0 -8 M12 2.5 v2 M12 19.5 v2 M2.5 12 h2 M19.5 12 h2 M5.3 5.3 l1.4 1.4 M17.3 17.3 l1.4 1.4 M18.7 5.3 l-1.4 1.4 M6.7 17.3 l-1.4 1.4',
  },
  moon: { d: 'M21 12.8 A9 9 0 1 1 11.2 3 a7 7 0 0 0 9.8 9.8 Z' },
  bloom: {
    d: 'M12 3 c1.2 4.2 2.8 5.8 7 7 c-4.2 1.2 -5.8 2.8 -7 7 c-1.2 -4.2 -2.8 -5.8 -7 -7 c4.2 -1.2 5.8 -2.8 7 -7 Z',
  },
  // The bloom theme's face — a cute cat (round head, two pointed ears, dot
  // eyes, tiny nose).
  cat: {
    d: 'M9 8 C7.3 6 6.6 4.2 7.2 3 C8.8 3.5 10.1 4.9 10.9 6.7 M15 8 C16.7 6 17.4 4.2 16.8 3 C15.2 3.5 13.9 4.9 13.1 6.7 M12 8 a5.7 5.7 0 1 0 0 11.4 a5.7 5.7 0 1 0 0 -11.4 M9.7 12.8 v0.01 M14.3 12.8 v0.01 M12 14.9 v0.01',
  },
  // Lines of verse — the lyrics entry on the player (a lyric sheet, not a mic).
  lyrics: { d: 'M5 6 h14 M5 10 h9 M5 14 h12 M5 18 h7' },
  wave: { d: 'M3 12 c1.5 -4.5 4.5 -4.5 6 0 s4.5 4.5 6 0 s4.5 -4.5 6 0' },
  // Equalizer faders: three verticals, each with its own knob.
  sliders: { d: 'M6 4 v6 M6 14 v6 M12 4 v10 M12 18 v2 M18 4 v2 M18 10 v10 M4 12 h4 M10 16 h4 M16 8 h4' },
  // Send arrow — the talk composer's submit.
  'arrow-right': { d: 'M3 12 h18 M14 5 l7 7 -7 7' },
  // Straight-up arrow — the dock's "take me back up" pill.
  'arrow-up': { d: 'M12 21 V3 M5 10 l7 -7 7 7' },
  // Checkmark — "already in this playlist" on the add-to-playlist rows.
  check: { d: 'M4 12 l5 5 L20 6' },
  eye: {
    d: 'M2.5 12 C5 7.7 8.3 5.5 12 5.5 s7 2.2 9.5 6.5 C19 16.3 15.7 18.5 12 18.5 S5 16.3 2.5 12 Z M12 12 m-2.6 0 a2.6 2.6 0 1 0 5.2 0 a2.6 2.6 0 1 0 -5.2 0',
  },
  'eye-off': {
    d: 'M2.5 12 C5 7.7 8.3 5.5 12 5.5 s7 2.2 9.5 6.5 C19 16.3 15.7 18.5 12 18.5 S5 16.3 2.5 12 Z M12 12 m-2.6 0 a2.6 2.6 0 1 0 5.2 0 a2.6 2.6 0 1 0 -5.2 0 M5 4 l14.5 16',
  },
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
        strokeWidth={
          icon.fill ? 0 : icon.thick ? strokeWidth + 0.6 : strokeWidth
        }
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={icon.fill ? color : 'none'}
      />
    </Svg>
  );
}
