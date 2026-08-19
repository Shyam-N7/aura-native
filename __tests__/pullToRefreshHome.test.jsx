import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import HomeScreen from '../src/screens/HomeScreen';
import { invalidateHomeCache } from '../src/lib/homeCache';

// Home is the one screen where "refresh" is not one fetch, and where a pull
// could easily do nothing at all: every section is CACHE-FIRST — it reads
// homeCache and skips its fetch when the key is there — so a naive refresh
// re-runs the hooks, finds the cache populated, and returns the same page it
// was already showing. The mechanism under test is the handshake that avoids
// that: the pull re-fetches every section, writes the results into the cache,
// and only then bumps the nonce the sections read.
// The hook's return, as HomeScreen itself received it. The RefreshControl it
// used to hand back is gone — see src/components/ui/Bounce.jsx — so the pull
// is fired through the hook's own onRefresh.
let mockLastPull = null;
jest.mock('../src/hooks/usePullRefresh', () => {
  const actual = jest.requireActual('../src/hooks/usePullRefresh');
  return {
    ...actual,
    usePullRefresh: (...args) => {
      const r = actual.usePullRefresh(...args);
      mockLastPull = r;
      return r;
    },
  };
});

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
  getModeEpoch: () => 0,
  getUser: () => ({ name: 'Shyam N', email: 's@x.y' }),
  getActiveExplicitOff: () => false,
  subscribeAuth: jest.fn(() => () => {}),
}));
jest.mock('../src/api/catalog', () => ({
  getTrack: jest.fn(),
  getFeatured: jest.fn(() => Promise.resolve([])),
  getHomeHero: jest.fn(() => Promise.resolve(null)),
  getHomeNewForYou: jest.fn(() => Promise.resolve(null)),
  getHomeStations: jest.fn(() => Promise.resolve(null)),
}));
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
jest.mock('../src/api/related', () => ({
  getRelated: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../src/api/impressions', () => ({ logImpressions: jest.fn() }));
jest.mock('../src/playback/engine', () => ({
  isBackgroundPlay: () => true,
  setBackgroundPlay: jest.fn(() => Promise.resolve()),
}));

const { getQuickPicks } = require('../src/api/quickPicks');
const { getTopArtists } = require('../src/api/stats');
const { getHomeHero } = require('../src/api/catalog');
const { listAutoPlaylists } = require('../src/api/autoPlaylists');

const control = () => mockLastPull;

describe('home pulls itself fresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // The cache outlives a screen by design — it must not outlive a test.
    invalidateHomeCache();
  });

  test('the pull re-runs every section and the new data reaches the screen', async () => {
    getTopArtists.mockResolvedValueOnce([]);

    let tree;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <HomeScreen navigation={{ navigate: jest.fn(), push: jest.fn() }} />
        </ThemeProvider>,
      );
    });
    expect(getQuickPicks).toHaveBeenCalledTimes(1);
    expect(tree.root.findAllByProps({ accessibilityLabel: 'ilaiyaraaja' })
      .length).toBe(0);

    // What the server says the second time.
    getTopArtists.mockResolvedValueOnce([
      { artist: 'ilaiyaraaja', playCount: 12, sampleTrack: { id: 't1' } },
    ]);

    await ReactTestRenderer.act(async () => {
      await control().onRefresh();
    });

    // Every cache-first section asked again — not just the ones that happened
    // to be empty — plus the mixes and the personalization block.
    expect(getQuickPicks).toHaveBeenCalledTimes(2);
    expect(getTopArtists).toHaveBeenCalledTimes(2);
    expect(listAutoPlaylists).toHaveBeenCalledTimes(2);
    expect(getHomeHero).toHaveBeenCalledTimes(2);
    // And the section is showing what came back, which is the half a
    // cache-first screen can silently skip.
    expect(
      tree.root.findAllByProps({ accessibilityLabel: 'ilaiyaraaja' }).length,
    ).toBeGreaterThan(0);
    expect(control().refreshing).toBe(false);
  });

  test('a section that fails keeps its shelf, and the spinner still leaves', async () => {
    getTopArtists.mockResolvedValueOnce([
      { artist: 'ilaiyaraaja', playCount: 12, sampleTrack: { id: 't1' } },
    ]);
    let tree;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <HomeScreen navigation={{ navigate: jest.fn(), push: jest.fn() }} />
        </ThemeProvider>,
      );
    });
    expect(
      tree.root.findAllByProps({ accessibilityLabel: 'ilaiyaraaja' }).length,
    ).toBeGreaterThan(0);

    getTopArtists.mockRejectedValueOnce(new Error('network down'));
    await ReactTestRenderer.act(async () => {
      await control().onRefresh();
    });

    // Half a Home is still a Home: the shelf keeps the artists it had.
    expect(
      tree.root.findAllByProps({ accessibilityLabel: 'ilaiyaraaja' }).length,
    ).toBeGreaterThan(0);
    expect(control().refreshing).toBe(false);
  });
});
