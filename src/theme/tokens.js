// Ported from the web repo: src/styles/global.css (@theme + .theme-* overrides)
// with src/data/themes.js filling the values the CSS never overrides.
// CSS linear-gradient stage backgrounds become flat stageBgStart/stageBgEnd
// endpoints since RN has no gradient strings.
// accentCard = accentSoft pre-blended over bg to an OPAQUE color. Android
// elevation shadows ghost through translucent fills (the shadow rect shows
// inside the card), so elevated accent surfaces must use this instead.
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
    accentCard: '#e0ccba',
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
    accentCard: '#3e2e23',
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
    accentCard: '#e7d0d0',
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
  queueHero: {
    fontFamily: fonts.regular,
    fontSize: 44,
    lineHeight: 43,
    letterSpacing: -1.32,
  },
  // The standalone screens' page title (dna, journal, bridges, equalizer,
  // admin compose) — the queueHero register one step down. Vertical spacing is
  // deliberately NOT in here: every screen sets its own margins around it.
  pageTitle: {
    fontFamily: fonts.regular,
    fontSize: 34,
    lineHeight: 36,
    letterSpacing: -1.02,
  },
  searchInput: {
    fontFamily: fonts.regular,
    fontSize: 24,
    letterSpacing: -0.12,
  },
  playerTitle: {
    fontFamily: fonts.semibold,
    fontSize: 26,
    lineHeight: 29,
    letterSpacing: -0.39,
  },
  sectionTitle: {
    fontFamily: fonts.semibold,
    fontSize: 22,
    letterSpacing: -0.11,
  },
  wordmark: { fontFamily: fonts.semibold, fontSize: 24, letterSpacing: -0.48 },
  rowTitle: { fontFamily: fonts.medium, fontSize: 15 },
  body: { fontFamily: fonts.regular, fontSize: 14 },
  time: {
    fontFamily: fonts.regular,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
};

// The web's MonoLabel register: 500 weight, uppercase, tracking 0.08em.
export const label = size => ({
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

// RN Android shadows = elevation (+ shadowColor tint on API 28+). OPAQUE
// backgrounds only — Android renders an elevated translucent view as an opaque
// white slab (this is why glass chrome carries no elevation at all).
export const elevation = {
  art: { elevation: 14, shadowColor: '#000' },
  accentGlow: accent => ({ elevation: 12, shadowColor: accent }),
};

// Web glass recipe: gradient shimmer + hairline border + inset top-light over
// the tint. Shimmer is white at these opacities (numeric, for rn-svg's sake).
// Tuned "thick" (owner's reference, 2026-07-30): stronger diagonal shimmer,
// brighter rim + top bevel, and a dark inner bottom edge (insetShade) so the
// pill reads as a slab of glass with depth, not a film.
export const glass = {
  // Backdrop blur strength (GlassView). RenderEffect applies this at full
  // resolution, so match the web's blur(40px) directly — at 20 the hard edges
  // of cards behind the bars survived as boxy seams (owner field report).
  backdropRadius: 40,
  shimmerFrom: 0.14,
  shimmerTo: 0.035,
  // Blur register runs the web's exact shimmer (MobileDock.css gradient):
  // the tint register's hotter "thick" values over real blur read as extra
  // white wash — with saturate(180%) now live, web-exact keeps the backdrop
  // colour rich instead of milky.
  blurShimmerFrom: 0.09,
  blurShimmerTo: 0.02,
  border: 'rgba(255,255,255,0.18)',
  insetLight: 'rgba(255,255,255,0.35)',
  // Light glass gets its depth from brightness (bevel + shimmer), NOT a dark
  // edge — the web's light mode carries no shade band (owner's reference).
  // Whisper values here; midnight is where the slab shows its dark under-edge.
  insetShade: 'rgba(31,23,14,0.05)',
  underShade: 0.05,
  discBg: 'rgba(22,19,16,0.34)',
  discBorder: 'rgba(255,255,255,0.22)',
  midnight: {
    shimmerFrom: 0.11,
    shimmerTo: 0.025,
    blurShimmerFrom: 0.07,
    blurShimmerTo: 0.015,
    border: 'rgba(255,255,255,0.14)',
    insetLight: 'rgba(255,255,255,0.20)',
    insetShade: 'rgba(0,0,0,0.30)',
    underShade: 0.2,
  },
};

// Glass body: the theme surface at high alpha. Stands in for backdrop blur —
// over flat theme backgrounds it reads the same, and it can't break or lag.
export const glassTint = {
  dusk: 'rgba(244,236,224,0.86)',
  midnight: 'rgba(35,30,24,0.88)',
  bloom: 'rgba(251,243,239,0.86)',
};

// Softer glass body for chrome that FLOATS OVER SCROLLING CONTENT (the dock):
// at 0.86 nothing ghosts through and the capsule reads as a solid bar. ~0.80
// reads as frosted glass — a clear bar you still sense content behind, the
// closest this stack gets to the web's backdrop blur (capture-based blur is
// broken on-device; see Glass.jsx). 0.70 let too much through and looked thin.
// 0.87: shapes behind dissolve into colour bleed (translucent), instead of
// ghosting through sharply (transparent) — owner-tuned live over real art.
// The web gets this from backdrop blur; opacity is the honest native dial.
export const glassTintSoft = {
  dusk: 'rgba(244,236,224,0.87)',
  midnight: 'rgba(35,30,24,0.88)',
  bloom: 'rgba(251,243,239,0.87)',
};

// Opaque fill used while goo is fusing (the web swaps glass for color-mix during the
// morph window so the metaball has alpha to merge): surface nudged ~9% toward white.
export const gooFill = {
  dusk: '#f5eee3',
  midnight: '#332e28',
  bloom: '#fcf4f1',
};
