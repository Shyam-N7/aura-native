import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import HomeScreen from '../src/screens/HomeScreen';
import { getFeatured } from '../src/api/catalog';
import { invalidateHomeCache } from '../src/lib/homeCache';
import { storage } from '../src/storage/mmkv';

// Home with NOTHING on disk: first run offline, or a sign-out that cleared the
// caches. Every section self-hides when empty, so a failed cold fetch used to
// leave a greeting over blank space — the app read as broken, not as unable to
// load, and there was no way to ask again.
jest.mock('../src/playback/PlayerContext', () => ({
  usePlayer: () => ({
    current: null,
    queue: { tracks: [], idx: -1, source: null },
    isPlaying: false,
    playQueue: jest.fn(),
    playTrack: jest.fn(),
    ui: { playerOpen: false, openPlayer: jest.fn() },
  }),
}));
jest.mock('../src/lib/auth', () => ({
  getUser: () => ({ name: 'Shyam N', email: 's@x.y' }),
  getActiveExplicitOff: () => false,
  subscribeAuth: jest.fn(() => () => {}),
}));
jest.mock('../src/api/catalog', () => ({
  getTrack: jest.fn(),
  getFeatured: jest.fn(),
  getHomeHero: jest.fn(async () => null),
  getHomeNewForYou: jest.fn(async () => null),
  getHomeStations: jest.fn(async () => null),
}));
// Every section empty — the state this screen is being pinned for.
jest.mock('../src/api/quickPicks', () => ({
  getQuickPicks: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../src/api/stats', () => ({
  getMostPlayed: jest.fn(() => Promise.resolve([])),
  getTopArtists: jest.fn(() => Promise.resolve([])),
  getRecentlyPlayed: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../src/api/playlists', () => ({
  listPlaylists: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../src/api/autoPlaylists', () => ({
  listAutoPlaylists: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../src/api/discover', () => ({
  getDiscoverHome: jest.fn(() => Promise.resolve({ popularPlaylists: [] })),
}));
jest.mock('../src/api/impressions', () => ({ logImpressions: jest.fn() }));
jest.mock('../src/playback/engine', () => ({
  isBackgroundPlay: () => true,
  setBackgroundPlay: jest.fn(() => Promise.resolve()),
}));

function texts(node) {
  if (node == null) {
    return '';
  }
  if (typeof node === 'string') {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map(texts).join('');
  }
  return texts(node.children);
}
const byLabel = (tree, accessibilityLabel) =>
  tree.root.findAllByProps({ accessibilityLabel })[0];

async function render(node) {
  let tree;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
}

const TRACK = { id: 't1', title: 'Song', artist: 'a' };
const POOL_SNAPSHOT = 'aura.snapshot.featured.everyday';

beforeEach(() => {
  jest.clearAllMocks();
  invalidateHomeCache();
  storage.removeItem(POOL_SNAPSHOT);
});

test('nothing cached and the fetch fails: home says so, and try again refetches', async () => {
  getFeatured.mockRejectedValue(new Error('network'));
  const tree = await render(<HomeScreen />);

  const body = texts(tree.toJSON());
  expect(body).toContain("couldn't load your music.");
  expect(body).toContain('check your connection and try again.');
  // No NetInfo in this app — it cannot assert the user is offline.
  expect(body.toLowerCase()).not.toContain('offline');

  getFeatured.mockResolvedValueOnce([TRACK]);
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'try again').props.onPress();
  });
  expect(getFeatured).toHaveBeenCalledTimes(2);
  expect(texts(tree.toJSON())).not.toContain("couldn't load your music.");
  // Real home is back: the hero band offers the set again.
  expect(byLabel(tree, 'begin the set')).toBeTruthy();

  await ReactTestRenderer.act(() => tree.unmount());
});

test('a failed refresh keeps the cached pool — no error state over real content', async () => {
  storage.setItem(POOL_SNAPSHOT, JSON.stringify({ u: 's@x.y', d: [TRACK] }));
  getFeatured.mockRejectedValue(new Error('network'));
  const tree = await render(<HomeScreen />);

  expect(texts(tree.toJSON())).not.toContain("couldn't load your music.");
  expect(byLabel(tree, 'begin the set')).toBeTruthy();

  await ReactTestRenderer.act(() => tree.unmount());
});
