import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import HomeScreen from '../src/screens/HomeScreen';
import TalkScreen from '../src/screens/TalkScreen';
import YouScreen from '../src/screens/YouScreen';
import { groupPlaysByDay } from '../src/screens/HistoryScreen';
import { getFeatured } from '../src/api/catalog';
import { invalidateHomeCache } from '../src/lib/homeCache';
import { _resetLikesStore } from '../src/hooks/useLikes';

const mockPlayQueue = jest.fn();
const mockPlayTrack = jest.fn();
const mockOpenPlayer = jest.fn();
const mockSetQuality = jest.fn();
jest.mock('../src/playback/PlayerContext', () => ({
  usePlayer: () => ({
    current: null,
    queue: { tracks: [], idx: -1, source: null },
    isPlaying: false,
    quality: 'high',
    playQueue: mockPlayQueue,
    playTrack: mockPlayTrack,
    setQuality: mockSetQuality,
    ui: { playerOpen: false, openPlayer: mockOpenPlayer },
  }),
}));
jest.mock('../src/lib/auth', () => ({
  getUser: () => ({ name: 'Shyam N', email: 's@x.y' }),
  getActiveExplicitOff: () => false,
  logout: jest.fn(),
}));
jest.mock('../src/api/catalog', () => ({
  searchCatalog: jest.fn(),
  getTrack: jest.fn(),
  getFeatured: jest.fn(),
}));
// Home section fetches — empty by default so sections self-hide and the
// featured pool (mocked above) feeds the quick-picks fallback chain.
jest.mock('../src/api/quickPicks', () => ({
  getQuickPicks: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../src/api/stats', () => ({
  getMostPlayed: jest.fn(() => Promise.resolve([])),
  getTopArtists: jest.fn(() => Promise.resolve([])),
  getRecentlyPlayed: jest.fn(() => Promise.resolve([])),
  getHistory: jest.fn(() => Promise.resolve({ plays: [], nextBefore: null })),
  getMusicClockPlays: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../src/api/library', () => ({
  getLibrarySummary: jest.fn(() =>
    Promise.resolve({
      tracksPlayed: 12,
      minutesListened: 34,
      topLanguage: 'tamil',
      likedCount: 1,
      playlistCount: 0,
    }),
  ),
}));
jest.mock('../src/api/hidden', () => ({
  listHidden: jest.fn(() => Promise.resolve([])),
  unhideTrack: jest.fn(() => Promise.resolve()),
}));
jest.mock('../src/api/likes', () => ({
  listLiked: jest.fn(() =>
    Promise.resolve([
      {
        id: 'l1',
        title: 'Liked Song',
        artist: 'A',
        language: 'tamil',
        durationSec: 100,
      },
    ]),
  ),
  listLikedIds: jest.fn(() => Promise.resolve(['l1'])),
  likeTrack: jest.fn(() => Promise.resolve()),
  unlikeTrack: jest.fn(() => Promise.resolve()),
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
jest.mock('../src/api/impressions', () => ({
  logImpressions: jest.fn(),
}));

// Rendered text only, joined in order (a Text's children can be split).
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

beforeEach(() => {
  jest.clearAllMocks();
  invalidateHomeCache();
  _resetLikesStore();
});

test("home greets and begins tonight's set from the hero band", async () => {
  const tracks = [
    {
      id: 't1',
      title: 'Song',
      artist: 'a',
      imageUrl: 'https://c/i_150x150.jpg',
    },
    { id: 't2', title: 'Other', artist: 'b' },
  ];
  getFeatured.mockResolvedValue(tracks);
  const tree = await render(<HomeScreen />);

  const body = texts(tree.toJSON());
  expect(body).toMatch(/good (morning|afternoon|evening), shyam/);
  expect(body).toContain('music that gets your mood');
  expect(getFeatured).toHaveBeenCalledWith({ limit: 24 });

  // The pool feeds the quick-picks fallback — the wheel renders its discs.
  expect(byLabel(tree, 'play Song')).toBeTruthy();

  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'begin the set').props.onPress();
  });
  expect(mockPlayQueue).toHaveBeenCalledWith(tracks, 0, "tonight's set");
  expect(mockOpenPlayer).toHaveBeenCalled();

  await ReactTestRenderer.act(() => tree.unmount());
});

test('talk is an honest placeholder', async () => {
  const tree = await render(<TalkScreen />);
  expect(texts(tree.toJSON())).toContain('coming in the next build');
  await ReactTestRenderer.act(() => tree.unmount());
});

test('you is the library: your year, accordion shelves, settings', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const navigation = {
    navigate: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  };
  const tree = await render(<YouScreen navigation={navigation} />);

  const body = texts(tree.toJSON());
  expect(body).toContain('your year');
  expect(body).toContain('12 tracks played');
  expect(body).toContain('for 34 minutes');
  expect(body).toContain('Shyam N');
  expect(body).toContain('s@x.y');

  // Liked shelf opens, plays the liked sequence, links to the full page.
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'liked songs').props.onPress();
  });
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'play Liked Song').props.onPress();
  });
  expect(mockPlayQueue).toHaveBeenCalledWith(
    [expect.objectContaining({ id: 'l1' })],
    0,
    'your liked',
  );
  expect(mockOpenPlayer).toHaveBeenCalled();
  byLabel(tree, 'see all liked songs').props.onPress();
  expect(navigation.navigate).toHaveBeenCalledWith('Liked');

  // Settings shelf hosts the quality picker and sign out.
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'settings').props.onPress();
  });
  byLabel(tree, 'quality low').props.onPress();
  expect(mockSetQuality).toHaveBeenCalledWith('low');
  byLabel(tree, 'sign out').props.onPress();
  expect(alertSpy).toHaveBeenCalled();

  alertSpy.mockRestore();
  await ReactTestRenderer.act(() => tree.unmount());
});

test('history groups plays into contiguous local-day sections', () => {
  const now = new Date(2026, 6, 15, 12);
  const ts = (day, hour) => new Date(2026, 6, day, hour).getTime();
  const days = groupPlaysByDay(
    [
      { id: 'a', playedAt: ts(15, 9) },
      { id: 'b', playedAt: ts(15, 1) },
      { id: 'c', playedAt: ts(14, 23) },
      { id: 'd', playedAt: ts(10, 8) },
    ],
    now,
  );
  expect(days.map(d => d.heading)).toEqual([
    'Today',
    'Yesterday',
    new Date(ts(10, 8)).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    }),
  ]);
  expect(days[0].data).toHaveLength(2);
  expect(days[2].data.map(p => p.id)).toEqual(['d']);
});
