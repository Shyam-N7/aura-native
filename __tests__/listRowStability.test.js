const fs = require('fs');
const path = require('path');

// A CONTRACT LOCK, not evidence of a speed-up.
//
// `DetailRow` is React.memo'd (components/detail/DetailChassis.jsx), and that
// memo earns nothing unless the caller hands it stable props. Three things
// defeat it, each on its own:
//
//   renderItem defined in the render body   → new identity every render
//   onPress={() => playFrom(i)}             → a fresh closure per row
//   menu={{ … }}                            → a fresh object per row
//
// All three were live on Album/Playlist/CatalogPlaylist while the memo was
// already in place, so the memo looked like a fix and changed nothing. Jest
// cannot see frame timing, so this cannot prove scrolling got faster — it only
// stops the pattern coming back, which is the failure mode that actually
// happened here.

const screen = name =>
  fs.readFileSync(path.join(__dirname, '..', 'src', 'screens', name), 'utf8');

// Comments in these files QUOTE the anti-pattern in order to explain it, so a
// raw text match reads the explanation as a violation. Strip line comments.
const code = body => body.replace(/^\s*\/\/.*$/gm, '');

// Just the row renderer, so header buttons and sheets are out of scope.
const renderRegion = body => {
  const start = body.search(/const render(Row|Item) = useCallback\(/);
  if (start < 0) {
    return '';
  }
  const end = body.indexOf('\n  );', start);
  return body.slice(start, end < 0 ? body.length : end);
};

// Every screen whose list length the user controls and whose rows are DetailRow.
const DETAIL_SCREENS = [
  'LikedScreen.jsx',
  'AlbumScreen.jsx',
  'PlaylistScreen.jsx',
  'CatalogPlaylistScreen.jsx',
];

describe('nothing inline reaches a memoized row', () => {
  test.each(DETAIL_SCREENS)('%s wraps its row renderer', name => {
    const body = screen(name);
    // `const renderX = useCallback(` — a plain arrow here is a new identity
    // on every render, which re-runs the renderer for every mounted cell.
    expect(body).toMatch(/const render(Row|Item) = useCallback\(/);
  });

  test.each(DETAIL_SCREENS)('%s passes no fresh closure as onPress', name => {
    // Scoped to the row renderer: these screens are full of legitimate inline
    // handlers on header buttons, and a whole-file match fails on correct code.
    // (It did — which is the only reason this is scoped rather than blunt.)
    const body = renderRegion(screen(name));
    // Never let the scoping silently no-op: an empty region would pass this
    // assertion against any code at all.
    expect(body).not.toBe('');
    // The row components take `onPlay` + an index and build the closure once,
    // inside their own useCallback.
    expect(body).not.toMatch(/onPress=\{\(\) =>/);
    expect(screen(name)).toContain('onPress={press}');
  });

  test.each(DETAIL_SCREENS)('%s passes no object literal as menu', name => {
    // Every `menu=` in the file, wherever it sits — hoisted (ROW_MENU) when
    // constant, useMemo'd (menu) when it depends on the track.
    const passed = code(screen(name)).match(/menu=\{[^}]*\}?/g) ?? [];
    expect(passed.length).toBeGreaterThan(0);
    for (const site of passed) {
      expect(site).toMatch(/^menu=\{(ROW_MENU|menu)\}$/);
    }
  });

  test.each(DETAIL_SCREENS)('%s memoizes the list data', name => {
    const body = screen(name);
    // `hit.data?.tracks ?? []` evaluated in the render body is a new array
    // identity every render, which VirtualizedList reads as "the data changed"
    // and re-renders every mounted cell — defeating the row memo from above.
    expect(body).not.toMatch(/^\s*const tracks = hit\.data\?\.tracks/m);
  });
});

// The player context value takes a new identity on every track advance and
// every play/pause. A row callback that depends on it is re-created on each of
// those, so a memoized row re-renders while a song is simply playing — the
// thing the memo was added to stop. These callbacks only ever run on a tap, so
// they read the current value off a ref instead.
describe('a playing song does not invalidate the rows', () => {
  test.each(DETAIL_SCREENS)('%s does not depend on the player value', name => {
    const body = screen(name);
    expect(body).toContain('playerRef.current');
    expect(body).not.toMatch(/const playFrom = useCallback\([\s\S]*?\[player\]/);
  });
});
