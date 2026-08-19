import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import YouScreen from '../src/screens/YouScreen';
import HistoryScreen from '../src/screens/HistoryScreen';
import AlbumScreen from '../src/screens/AlbumScreen';
import LikedScreen from '../src/screens/LikedScreen';
import DnaScreen from '../src/screens/DnaScreen';
import { getPushPrefs, setPushPrefs } from '../src/lib/push';
import { getHistory } from '../src/api/stats';
import { listLiked, listLikedIds } from '../src/api/likes';
import { getAlbum } from '../src/api/catalog';
import { getSonicDna } from '../src/api/sonicDna';
import { resetLikesStore } from '../src/hooks/useLikes';

// The two loads whose failures used to be swallowed into a lie: the
// notification switches painted "all on" for an account they never fetched,
// and history's load-more blinked its spinner and gave up in silence.

jest.mock('../src/playback/PlayerContext', () => ({
  usePlayer: () => ({
    current: null,
    queue: { tracks: [], idx: -1, source: null },
    isPlaying: false,
    quality: 'high',
    playQueue: jest.fn(),
    playTrack: jest.fn(),
    setQuality: jest.fn(),
    ui: { playerOpen: false, openPlayer: jest.fn() },
  }),
}));
jest.mock('../src/lib/auth', () => ({
  getModeEpoch: () => 0,
  getUser: () => ({ name: 'Shyam N', email: 's@x.y' }),
  getActiveExplicitOff: () => false,
  subscribeAuth: jest.fn(() => () => {}),
  setMyAvatar: jest.fn(),
  clearMyAvatar: jest.fn(),
  enableFamilyMode: jest.fn(),
  disableFamilyMode: jest.fn(),
  updatePreferences: jest.fn(() => Promise.resolve({})),
  logout: jest.fn(),
}));
jest.mock('../src/lib/push', () => ({
  getPushPrefs: jest.fn(),
  setPushPrefs: jest.fn(),
  // The OS-permission row: granted by default so these failure-path tests
  // stay about the PREFS fetch, not the permission state.
  osPermissionGranted: jest.fn(() => Promise.resolve(true)),
  repairNotifications: jest.fn(),
}));
jest.mock('../src/api/stats', () => ({
  getHistory: jest.fn(),
  getMusicClockPlays: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../src/api/library', () => ({
  getLibrarySummary: jest.fn(() =>
    Promise.resolve({ tracksPlayed: 12, minutesListened: 34 }),
  ),
}));
jest.mock('../src/api/hidden', () => ({
  listHidden: jest.fn(() => Promise.resolve([])),
  unhideTrack: jest.fn(() => Promise.resolve()),
}));
jest.mock('../src/api/likes', () => ({
  listLiked: jest.fn(() => Promise.resolve([])),
  listLikedIds: jest.fn(() => Promise.resolve([])),
  likeTrack: jest.fn(() => Promise.resolve()),
  unlikeTrack: jest.fn(() => Promise.resolve()),
}));
jest.mock('../src/api/playlists', () => ({
  listPlaylists: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../src/lib/confirm', () => ({
  confirm: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('../src/api/catalog', () => ({
  getAlbum: jest.fn(),
  getTrack: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../src/api/sonicDna', () => ({
  getSonicDna: jest.fn(),
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
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetLikesStore();
  getHistory.mockResolvedValue({ plays: [], nextBefore: null });
  // The client like-set has to boot, or LikedScreen filters every server row
  // out of the list (the "liked looks empty" race the screen guards against).
  listLikedIds.mockResolvedValue(['l1']);
});

test('a failed prefs fetch says so and retries — it never paints the switches on', async () => {
  getPushPrefs.mockRejectedValueOnce(new Error('offline'));
  const navigation = {
    navigate: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  };
  const tree = await render(<YouScreen navigation={navigation} />);
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'Settings').props.onPress();
  });

  // The bug: all three rows rendered from the null fallback (on, in the accent
  // colour) and quietly ate every tap. They must not be there at all.
  expect(byLabel(tree, 'New music for you')).toBeUndefined();
  expect(byLabel(tree, 'Friends & playlists')).toBeUndefined();
  expect(byLabel(tree, 'Listening reminders')).toBeUndefined();
  expect(texts(tree.toJSON())).toContain(
    "Couldn't load your notification settings.",
  );

  // Recoverable by hand, and the rows then wear the account's real state —
  // mixes off, not the fallback's on.
  getPushPrefs.mockResolvedValueOnce({ mixes: false, social: true });
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'try again').props.onPress();
  });
  const mixesRow = () => byLabel(tree, 'New music for you');
  expect(mixesRow().props.accessibilityState).toEqual({});
  expect(texts(tree.toJSON())).toContain('No mix announcements.');

  // And the switch is live again.
  setPushPrefs.mockResolvedValueOnce({ mixes: true, social: true });
  await ReactTestRenderer.act(async () => {
    mixesRow().props.onPress();
  });
  expect(setPushPrefs).toHaveBeenCalledWith({ mixes: true });

  await ReactTestRenderer.act(() => tree.unmount());
});

test('a failed history page says so instead of reading as the end of history', async () => {
  const play = (id, hour) => ({
    id,
    title: `Song ${id}`,
    artist: 'a',
    language: 'tamil',
    playedAt: new Date(2026, 6, 15, hour).getTime(),
  });
  getHistory
    .mockResolvedValueOnce({ plays: [play('t1', 9)], nextBefore: 1000 })
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ plays: [play('t2', 8)], nextBefore: null });

  const tree = await render(
    <HistoryScreen navigation={{ goBack: jest.fn() }} />,
  );
  expect(texts(tree.toJSON())).toContain('Load more');

  // The bug: the page failed, the spinner stopped, nothing said why — the
  // screen read as "that's all of it" or as a dead button.
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'load more').props.onPress();
  });
  let body = texts(tree.toJSON());
  expect(body).toContain("Couldn't load more.");
  expect(body).toContain('Try again');
  expect(body).not.toContain('Song t2');

  // Tapping again picks the same page back up.
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'load more').props.onPress();
  });
  body = texts(tree.toJSON());
  expect(body).toContain('Song t2');
  expect(body).not.toContain("Couldn't load more.");
  expect(byLabel(tree, 'load more')).toBeUndefined();

  await ReactTestRenderer.act(() => tree.unmount());
});

// Q3: page two got a "Try again"; page one got a full stop. A first-page
// failure is the one you are most likely to hit (open the screen offline) and
// was the one with no way out.
test('a failed first history page can be retried, like the second one can', async () => {
  getHistory.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
    plays: [
      {
        id: 't1',
        title: 'Song t1',
        artist: 'a',
        language: 'tamil',
        playedAt: new Date(2026, 6, 15, 9).getTime(),
      },
    ],
    nextBefore: null,
  });

  const tree = await render(
    <HistoryScreen navigation={{ goBack: jest.fn() }} />,
  );
  expect(texts(tree.toJSON())).toContain("Couldn't load your history.");

  const retry = byLabel(tree, 'try again');
  expect(retry).toBeDefined();
  // The touch-target floor: the pill is 33dp tall, so it carries hitSlop.
  expect(retry.props.hitSlop).toBe(8);

  await ReactTestRenderer.act(async () => {
    retry.props.onPress();
  });
  const body = texts(tree.toJSON());
  expect(body).toContain('Song t1');
  expect(body).not.toContain("Couldn't load your history.");
  expect(byLabel(tree, 'try again')).toBeUndefined();

  await ReactTestRenderer.act(() => tree.unmount());
});

// S3: the dead ends. Ten screens rendered a failure as one line of grey text
// and nothing else — Back was the only move, and Back throws the screen away
// instead of re-running the fetch that failed. These three cover the three
// shapes the fix takes: a param-keyed detail fetch (album), a plain list
// fetch (liked), and a standalone screen's single call (dna).

test('a failed album load offers the retry, and the retry refetches', async () => {
  getAlbum.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
    id: 'al1',
    name: 'Some Album',
    artist: 'someone, someone else',
    tracks: [],
  });

  const tree = await render(
    <AlbumScreen
      route={{ params: { id: 'al1' } }}
      navigation={{ goBack: jest.fn(), navigate: jest.fn() }}
    />,
  );
  expect(texts(tree.toJSON())).toContain("Couldn't load — offline");

  const retry = byLabel(tree, 'try again');
  expect(retry).toBeDefined();
  // The touch-target floor: the pill is 33dp tall, so it carries hitSlop.
  expect(retry.props.hitSlop).toBe(8);

  await ReactTestRenderer.act(async () => {
    retry.props.onPress();
  });
  expect(getAlbum).toHaveBeenCalledTimes(2);
  const body = texts(tree.toJSON());
  expect(body).toContain('Some Album');
  expect(body).not.toContain("Couldn't load");
  expect(byLabel(tree, 'try again')).toBeUndefined();

  await ReactTestRenderer.act(() => tree.unmount());
});

// The abort path is the one thing the retry must not break: leaving the screen
// mid-flight rejects the in-flight request, and that has never been an error
// the user did anything wrong to cause.
test('an aborted album request stays on the loader — it never paints as an error', async () => {
  const aborted = new Error('Aborted');
  aborted.name = 'AbortError';
  getAlbum.mockRejectedValueOnce(aborted);

  const tree = await render(
    <AlbumScreen
      route={{ params: { id: 'al1' } }}
      navigation={{ goBack: jest.fn(), navigate: jest.fn() }}
    />,
  );
  const body = texts(tree.toJSON());
  expect(body).not.toContain("Couldn't load");
  expect(body).toContain('Loading album');
  expect(byLabel(tree, 'try again')).toBeUndefined();

  await ReactTestRenderer.act(() => tree.unmount());
});

test('a failed liked-songs load can be retried instead of only backed out of', async () => {
  listLiked.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([
    { id: 'l1', title: 'Liked Song', artist: 'someone', durationSec: 200 },
  ]);

  const tree = await render(<LikedScreen navigation={{ goBack: jest.fn() }} />);
  expect(texts(tree.toJSON())).toContain("Couldn't load — offline");

  const retry = byLabel(tree, 'try again');
  expect(retry).toBeDefined();
  expect(retry.props.hitSlop).toBe(8);

  await ReactTestRenderer.act(async () => {
    retry.props.onPress();
  });
  expect(listLiked).toHaveBeenCalledTimes(2);
  const body = texts(tree.toJSON());
  expect(body).toContain('Liked Song');
  expect(body).not.toContain("Couldn't load");
  expect(byLabel(tree, 'try again')).toBeUndefined();

  await ReactTestRenderer.act(() => tree.unmount());
});

test('a failed sonic-dna build can be retried', async () => {
  getSonicDna
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({
      available: false,
      threshold: 40,
      eventsSeen: 3,
      signature: null,
    });

  const tree = await render(<DnaScreen navigation={{ goBack: jest.fn() }} />);
  expect(texts(tree.toJSON())).toContain("Couldn't load — offline");

  const retry = byLabel(tree, 'try again');
  expect(retry).toBeDefined();
  expect(retry.props.hitSlop).toBe(8);

  await ReactTestRenderer.act(async () => {
    retry.props.onPress();
  });
  expect(getSonicDna).toHaveBeenCalledTimes(2);
  const body = texts(tree.toJSON());
  // The retry landed on the real answer — not enough listening yet — which is
  // a different thing entirely from "couldn't load".
  expect(body).toContain('Not enough listening yet.');
  expect(body).not.toContain("Couldn't load");
  expect(byLabel(tree, 'try again')).toBeUndefined();

  await ReactTestRenderer.act(() => tree.unmount());
});
