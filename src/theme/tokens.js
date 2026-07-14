// Ported from the web repo: src/styles/global.css (@theme + .theme-* overrides)
// with src/data/themes.js filling the values the CSS never overrides.
// CSS linear-gradient stage backgrounds become flat stageBgStart/stageBgEnd
// endpoints since RN has no gradient strings.
export const themes = {
  dusk: {
    bg: '#e9dfd1',
    surface: '#f4ece0',
    ink: '#2a221c',
    inkSoft: 'rgba(42,34,28,0.62)',
    inkFaint: 'rgba(42,34,28,0.46)',
    line: 'rgba(42,34,28,0.10)',
    accent: '#b06a3f',
    accentSoft: 'rgba(176,106,63,0.16)',
    pageBg: '#d9cdb9',
    stageBgStart: '#d9cdb9',
    stageBgEnd: '#bca790',
  },
  midnight: {
    bg: '#1a1612',
    surface: '#231e18',
    ink: '#f0e8dc',
    inkSoft: 'rgba(240,232,220,0.62)',
    inkFaint: 'rgba(240,232,220,0.46)',
    line: 'rgba(240,232,220,0.10)',
    accent: '#e09971',
    accentSoft: 'rgba(224,153,113,0.18)',
    pageBg: '#110e0b',
    stageBgStart: '#0f0c09',
    stageBgEnd: '#1c1813',
  },
  bloom: {
    bg: '#f3e8e4',
    surface: '#fbf3ef',
    ink: '#2a1f23',
    inkSoft: 'rgba(42,31,35,0.62)',
    inkFaint: 'rgba(42,31,35,0.46)',
    line: 'rgba(42,31,35,0.10)',
    accent: '#a8556a',
    accentSoft: 'rgba(168,85,106,0.16)',
    pageBg: '#e6d2cf',
    stageBgStart: '#e6d2cf',
    stageBgEnd: '#c89eaa',
  },
};

export const defaultTheme = 'dusk';

// Hanken Grotesk is the app's single typeface (the web aliases serif/sans to it).
// Android resolves asset fonts by FILENAME — the file IS the weight, so these are
// never combined with fontWeight.
export const fonts = {
  regular: 'HankenGrotesk-Regular',
  medium: 'HankenGrotesk-Medium',
  semibold: 'HankenGrotesk-SemiBold',
  bold: 'HankenGrotesk-Bold',
};

// Web type scale (letterSpacing = the CSS em value × the px size).
export const type = {
  queueHero: { fontFamily: fonts.regular, fontSize: 44, lineHeight: 43, letterSpacing: -1.32 },
  searchInput: { fontFamily: fonts.regular, fontSize: 24, letterSpacing: -0.12 },
  playerTitle: { fontFamily: fonts.semibold, fontSize: 26, lineHeight: 29, letterSpacing: -0.39 },
  sectionTitle: { fontFamily: fonts.semibold, fontSize: 22, letterSpacing: -0.11 },
  wordmark: { fontFamily: fonts.semibold, fontSize: 20, letterSpacing: -0.4 },
  rowTitle: { fontFamily: fonts.medium, fontSize: 15 },
  body: { fontFamily: fonts.regular, fontSize: 14 },
  time: { fontFamily: fonts.regular, fontSize: 11, fontVariant: ['tabular-nums'] },
};

// The web's MonoLabel register: 500 weight, uppercase, tracking 0.08em.
export const label = (size) => ({
  fontFamily: fonts.medium,
  fontSize: size,
  letterSpacing: size * 0.08,
  textTransform: 'uppercase',
});

export const radii = {
  pill: 999,
  dock: 26,
  sheet: 22,
  card: 12,
  hero: 14,
  playerArt: 10,
  coverSm: 6,
  coverMd: 8,
  auth: 26,
  input: 12,
};

// RN Android shadows = elevation (+ shadowColor tint on API 28+). The web's glass
// inset top-light becomes a 1px hairline View inside Glass instead.
export const elevation = {
  card: { elevation: 6, shadowColor: '#000' },
  art: { elevation: 14, shadowColor: '#000' },
  glass: { elevation: 12, shadowColor: '#000' },
  bead: { elevation: 10, shadowColor: '#000' },
  sheet: { elevation: 24, shadowColor: '#000' },
  toast: { elevation: 10, shadowColor: '#000' },
  accentGlow: (accent) => ({ elevation: 12, shadowColor: accent }),
};

// Web glass recipe: gradient shimmer + hairline border + inset top-light OVER the blur.
export const glass = {
  gradFrom: 'rgba(255,255,255,0.09)',
  gradTo: 'rgba(255,255,255,0.02)',
  border: 'rgba(255,255,255,0.14)',
  insetLight: 'rgba(255,255,255,0.25)',
  blurAmount: 25,
  beadGradFrom: 'rgba(255,255,255,0.10)',
  discBg: 'rgba(22,19,16,0.34)',
  discBorder: 'rgba(255,255,255,0.22)',
  midnight: {
    gradFrom: 'rgba(255,255,255,0.07)',
    gradTo: 'rgba(255,255,255,0.015)',
    border: 'rgba(255,255,255,0.10)',
    insetLight: 'rgba(255,255,255,0.12)',
  },
};

// Opaque fill used while goo is fusing (the web swaps glass for color-mix during the
// morph window so the metaball has alpha to merge): surface nudged ~9% toward white.
export const gooFill = {
  dusk: '#f5eee3',
  midnight: '#332e28',
  bloom: '#fcf4f1',
};
