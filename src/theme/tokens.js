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
