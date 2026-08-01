import React from 'react';
import { confirm } from '../src/lib/confirm';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import HomeScreen from '../src/screens/HomeScreen';
import YouScreen from '../src/screens/YouScreen';
import { groupPlaysByDay } from '../src/screens/HistoryScreen';
import { getFeatured } from '../src/api/catalog';
import { updatePreferences } from '../src/lib/auth';
import { invalidateHomeCache } from '../src/lib/homeCache';
import { resetLikesStore } from '../src/hooks/useLikes';
import { storage } from '../src/storage/mmkv';

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
// Mutable so individual tests can flip capabilities (e.g. the admin row).
let mockUser = { name: 'Shyam N', email: 's@x.y' };
jest.mock('../src/lib/auth', () => ({
  getUser: () => mockUser,
  getActiveExplicitOff: () => false,
  subscribeAuth: jest.fn(() => () => {}),
  setMyAvatar: jest.fn(),
  clearMyAvatar: jest.fn(),
  enableFamilyMode: jest.fn(),
  disableFamilyMode: jest.fn(),
  updatePreferences: jest.fn(() => Promise.resolve({})),
  logout: jest.fn(),
}));
jest.mock('../src/api/catalog', () => ({
  searchCatalog: jest.fn(),
  getTrack: jest.fn(),
  getFeatured: jest.fn(),
  getHomeHero: jest.fn(async () => null),
  getHomeNewForYou: jest.fn(async () => null),
  getHomeStations: jest.fn(async () => null),
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
// House confirm: resolve false so destructive paths never run in tests.
jest.mock('../src/lib/confirm', () => ({
  confirm: jest.fn(() => Promise.resolve(false)),
}));
// The playback engine behind the background-play switch — isolated so the
// screen tests never touch RNTP or the quality chain.
const mockSetBackgroundPlay = jest.fn(() => Promise.resolve());
jest.mock('../src/playback/engine', () => ({
  isBackgroundPlay: () => true,
  setBackgroundPlay: (...a) => mockSetBackgroundPlay(...a),
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
  resetLikesStore();
  mockUser = { name: 'Shyam N', email: 's@x.y' };
  // The don't-ask flag persists in the in-memory MMKV across tests.
  storage.removeItem('aura.backgroundPlayNoConfirm');
});

test("home greets and begins tonight's set from the hero band", async () => {
  // The fallback hero rotates DAILY (heroFallbackIdx), so which track the
  // band offers depends on the calendar — pin the clock to a day that lands
  // on the first one, or this assertion flips every other night.
  const clock = jest.spyOn(Date, 'now').mockReturnValue(1784505600000);
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
  // A warm part-of-day greeting (rotates daily) followed by the first name.
  expect(body).toMatch(
    /(good morning|morning|rise and shine|good afternoon|afternoon|hey there|good evening|evening|good to see you|still up\?|up late\?|late night\?),? shyam/,
  );
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
  clock.mockRestore();
});

test('background play: the greeting-row switch confirms, then flips the engine', async () => {
  const tree = await render(<HomeScreen />);
  // The 2b rail: on by default; the visible caption is the status line
  // (the switch itself is named by its accessibility label).
  const toggle = byLabel(tree, 'background play');
  expect(toggle.props.accessibilityState).toEqual({ checked: true });
  expect(texts(tree.toJSON())).toContain('plays in background');

  // Tap → the confirm POPUP asks; cancel changes nothing.
  await ReactTestRenderer.act(async () => {
    toggle.props.onPress();
  });
  const body = texts(tree.toJSON());
  expect(body).toContain('turn off background play?');
  expect(body).toContain('music stops when you close the app.');
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'cancel').props.onPress();
  });
  expect(mockSetBackgroundPlay).not.toHaveBeenCalled();

  // Tap → confirm: the engine flips off.
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'background play').props.onPress();
  });
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'turn off').props.onPress();
  });
  expect(mockSetBackgroundPlay).toHaveBeenCalledWith(false);
  await ReactTestRenderer.act(() => tree.unmount());
});

test("background play: don't ask again silences the popup for good", async () => {
  const tree = await render(<HomeScreen />);
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'background play').props.onPress();
  });
  await ReactTestRenderer.act(async () => {
    byLabel(tree, "don't ask again").props.onPress();
  });
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'turn off').props.onPress();
  });
  expect(mockSetBackgroundPlay).toHaveBeenCalledWith(false);

  // The next flip applies straight away — no popup.
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'background play').props.onPress();
  });
  expect(texts(tree.toJSON())).not.toContain('turn on background play?');
  expect(mockSetBackgroundPlay).toHaveBeenCalledWith(true);
  await ReactTestRenderer.act(() => tree.unmount());
});

test('you is the library: your year, accordion shelves, settings', async () => {
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

  // Welcome-screen toggle: on by default (pref absent), optimistic flip while
  // the save is in flight, reverts when the save fails.
  expect(byLabel(tree, 'welcome screen').props.accessibilityState).toEqual({
    selected: true,
  });
  expect(texts(tree.toJSON())).toContain(
    'a short intro reads your mood when you open aura',
  );
  let resolveUpdate;
  updatePreferences.mockImplementationOnce(
    () => new Promise(r => (resolveUpdate = r)),
  );
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'welcome screen').props.onPress();
  });
  expect(updatePreferences).toHaveBeenCalledWith({ showSensing: false });
  expect(texts(tree.toJSON())).toContain(
    'skipped — you go straight to your home.',
  );
  await ReactTestRenderer.act(async () => resolveUpdate({}));
  updatePreferences.mockRejectedValueOnce(new Error('offline'));
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'welcome screen').props.onPress();
  });
  expect(texts(tree.toJSON())).toContain(
    'a short intro reads your mood when you open aura',
  );

  byLabel(tree, 'quality low').props.onPress();
  expect(mockSetQuality).toHaveBeenCalledWith('low');
  // Sign out asks through the house confirm sheet, not the OS Alert.
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'sign out').props.onPress();
  });
  expect(confirm).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'sign out' }),
  );

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

test('the settings admin row shows only for admins and routes to the composer', async () => {
  const navigation = {
    navigate: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  };

  // Not an admin: no row.
  let tree = await render(<YouScreen navigation={navigation} />);
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'settings').props.onPress();
  });
  expect(byLabel(tree, 'send a notification')).toBeUndefined();
  await ReactTestRenderer.act(() => tree.unmount());

  // Admin: the row exists and routes to the AdminCompose screen.
  mockUser = { name: 'Shyam N', email: 's@x.y', admin: true };
  tree = await render(<YouScreen navigation={navigation} />);
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'settings').props.onPress();
  });
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'send a notification').props.onPress();
  });
  expect(navigation.navigate).toHaveBeenCalledWith('AdminCompose');
  await ReactTestRenderer.act(() => tree.unmount());
});
