import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { LyricsOverlay } from '../src/overlays/LyricsOverlay';
import { HINT_KARAOKE, HINT_STAGE_TAP, hintDone } from '../src/lib/hints';
import { storage } from '../src/storage/mmkv';

jest.mock('react-native-track-player', () => ({
  useProgress: () => ({ position: 30, duration: 120, buffered: 0 }),
}));

// The real likes store boots with a network fetch on first use — a live TLS
// socket that can outlast the test process. The header heart only reads it.
jest.mock('../src/hooks/useLikes', () => ({
  useLikes: () => ({
    isLiked: () => false,
    like: jest.fn(async () => {}),
    unlike: jest.fn(async () => {}),
  }),
}));

const mockGetLyrics = jest.fn();
jest.mock('../src/api/lyrics', () => ({
  getLyrics: (...args) => mockGetLyrics(...args),
  prefetchLyrics: jest.fn(),
}));

const mockRequestStems = jest.fn();
jest.mock('../src/api/stems', () => ({
  requestStems: (...args) => mockRequestStems(...args),
}));

// The share sheet itself is native; only that the line reaches it matters here.
const mockShareLyric = jest.fn();
jest.mock('../src/lib/share', () => ({
  ...jest.requireActual('../src/lib/share'),
  shareLyric: (...args) => mockShareLyric(...args),
}));

const TRACK = {
  id: 't1',
  title: 'Current Song (From "Some Movie")',
  artist: 'someone',
  language: 'tamil',
  imageUrl: 'https://cdn/img_150x150.jpg',
  durationSec: 120,
};

// Mutable holder so each test can shape the player state before rendering.
const mockState = { player: null };
jest.mock('../src/playback/PlayerContext', () => ({
  usePlayer: () => mockState.player,
}));

function basePlayer(overrides = {}) {
  return {
    current: TRACK,
    queue: { tracks: [TRACK], idx: 0, source: 'more like this' },
    isPlaying: true,
    seekTo: jest.fn(),
    togglePlay: jest.fn(),
    musicOnly: false,
    setMusicOnly: jest.fn(),
    ui: {
      lyricsOpen: true,
      openLyrics: jest.fn(),
      closeLyrics: jest.fn(),
    },
    ...overrides,
  };
}

const SYNCED = {
  available: true,
  synced: true,
  has_english: true,
  source: 'lrc',
  lines: [
    { t: 2, line: 'முதல் வரி', line_en: 'First Words' },
    { t: 28, line: 'இரண்டாம் வரி', line_en: 'Second Words' },
    { t: 60, line: 'மூன்றாம் வரி', line_en: 'Third Words' },
  ],
};

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

async function render() {
  let tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <LyricsOverlay />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  storage.removeItem('aura.hintsDone');
  mockState.player = basePlayer();
  mockGetLyrics.mockResolvedValue(SYNCED);
});

test('renders nothing while the lyrics ui state is closed', async () => {
  mockState.player = basePlayer({
    ui: { lyricsOpen: false, closeLyrics: jest.fn() },
  });
  const tree = await render();
  expect(tree.toJSON()).toBeNull();
  expect(mockGetLyrics).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => tree.unmount());
});

test('synced lyrics: romanized by default, toggle swaps script, tap seeks', async () => {
  const tree = await render();
  expect(mockGetLyrics).toHaveBeenCalledWith('t1', expect.anything());

  // Default view is romanized ('en'); lines display cleaned + lowercased.
  let body = texts(tree.toJSON());
  expect(body).toContain('first words');
  expect(body).toContain('second words');
  expect(body).not.toContain('முதல் வரி');

  // The toggle exists because has_english — original side wears the language.
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'tamil').props.onPress();
  });
  body = texts(tree.toJSON());
  expect(body).toContain('முதல் வரி');
  expect(body).not.toContain('first words');

  // Tapping a line seeks to its timestamp.
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'இரண்டாம் வரி').props.onPress();
  });
  expect(mockState.player.seekTo).toHaveBeenCalledWith(28);

  // Close hands control back to the player underneath.
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'close lyrics').props.onPress();
  });
  expect(mockState.player.ui.closeLyrics).toHaveBeenCalled();

  await ReactTestRenderer.act(() => tree.unmount());
});

test('already-latin tracks hide the toggle and show the original script', async () => {
  mockGetLyrics.mockResolvedValue({
    ...SYNCED,
    has_english: false,
    lines: [{ t: 2, line: 'Plain English Line' }],
  });
  const tree = await render();
  const body = texts(tree.toJSON());
  expect(body).toContain('plain english line');
  expect(byLabel(tree, 'english')).toBeUndefined();
  await ReactTestRenderer.act(() => tree.unmount());
});

test('plain (untimed) lyrics carry the not-synced caption', async () => {
  mockGetLyrics.mockResolvedValue({
    available: true,
    synced: false,
    has_english: false,
    source: 'jiosaavn',
    lines: [{ line: 'Words Without Time' }],
  });
  const tree = await render();
  const body = texts(tree.toJSON());
  expect(body).toContain('words without time');
  expect(body).toContain("These lyrics aren't synced to the music.");
  await ReactTestRenderer.act(() => tree.unmount());
});

test('karaoke: hint shows until first entry, stage sings and taps play/pause', async () => {
  const tree = await render();

  // In-place discovery — the hint line sits with the pill, not in a tour.
  expect(texts(tree.toJSON())).toContain(
    'New — tap karaoke to sing along, line by line.',
  );

  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'karaoke').props.onPress();
  });
  // Entering retires the hint for good and swaps the pill label.
  expect(hintDone(HINT_KARAOKE)).toBe(true);
  const body = texts(tree.toJSON());
  expect(body).not.toContain('new — tap karaoke');
  expect(byLabel(tree, 'exit karaoke')).toBeTruthy();
  // 30s in: line 2 (t=28) is on stage, line 3 (t=60) previews below.
  expect(body).toContain('second words');
  expect(body).toContain('third words');
  // The glass stage-tap chip rides the stage until the tap is performed.
  expect(body).toContain('Tap the words to pause');

  // A tap on the stage itself is play/pause (karaoke ergonomics) — and
  // performing it retires the chip's hint for good.
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'pause').props.onPress();
  });
  expect(mockState.player.togglePlay).toHaveBeenCalled();
  expect(hintDone(HINT_STAGE_TAP)).toBe(true);
  expect(texts(tree.toJSON())).not.toContain('Tap the words to pause');

  await ReactTestRenderer.act(() => tree.unmount());
});

test('karaoke: music only prepares the instrumental and swaps the source', async () => {
  mockRequestStems.mockResolvedValue({
    status: 'done',
    url: 'https://blob/instrumental.mp3',
  });
  const tree = await render();
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'karaoke').props.onPress();
  });

  // The stage pill starts the preparation; the poll's first tick resolves
  // 'done' and hands the player the cached instrumental url.
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'music only').props.onPress();
  });
  expect(mockRequestStems).toHaveBeenCalledWith('t1', expect.anything());
  expect(mockState.player.setMusicOnly).toHaveBeenCalledWith(
    'https://blob/instrumental.mp3',
  );
  await ReactTestRenderer.act(() => tree.unmount());
});

test('karaoke: paused stage rests the coming line with a plain cue', async () => {
  mockState.player = basePlayer({ isPlaying: false });
  const tree = await render();
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'karaoke').props.onPress();
  });
  const body = texts(tree.toJSON());
  // Never an empty stage: the cue names the state, the tap label flips.
  expect(body).toContain('Paused — tap the words to continue');
  expect(byLabel(tree, 'play')).toBeTruthy();
  await ReactTestRenderer.act(() => tree.unmount());
});

test('pending and unavailable states explain themselves', async () => {
  mockGetLyrics.mockResolvedValue({
    available: false,
    synced: false,
    pending: true,
  });
  let tree = await render();
  expect(texts(tree.toJSON())).toContain('Syncing the lyrics…');
  await ReactTestRenderer.act(() => tree.unmount());

  mockGetLyrics.mockResolvedValue({ available: false, synced: false });
  tree = await render();
  expect(texts(tree.toJSON())).toContain("Lyrics aren't available");
  await ReactTestRenderer.act(() => tree.unmount());
});

// A4 — hold-a-line-to-share is the one gesture in the app that CANNOT grow a
// visible button (a ⋯ per lyric would wreck the column), so it is published as
// an assistive action instead — the QueueSheet reorder pattern.
const SHARE_ACTION = [{ name: 'share', label: 'share this line' }];

test('a synced lyric line names itself and offers its hold as an action', async () => {
  const tree = await render();
  const line = byLabel(tree, 'second words');
  expect(line.props.accessibilityRole).toBe('button');
  expect(line.props.accessibilityActions).toEqual(SHARE_ACTION);

  await ReactTestRenderer.act(async () => {
    line.props.onAccessibilityAction({ nativeEvent: { actionName: 'share' } });
  });
  expect(mockShareLyric).toHaveBeenCalledWith(TRACK, 'second words');

  // An unrelated action name is not the share.
  await ReactTestRenderer.act(async () => {
    line.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
  });
  expect(mockShareLyric).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(() => tree.unmount());
});

test('an untimed lyric line carries the same name and share action', async () => {
  mockGetLyrics.mockResolvedValue({
    available: true,
    synced: false,
    has_english: false,
    source: 'jiosaavn',
    lines: [{ line: 'Words Without Time' }],
  });
  const tree = await render();
  const line = byLabel(tree, 'words without time');
  // Untimed lines don't seek, so they are read as text, not offered as buttons.
  expect(line.props.accessibilityRole).toBe('text');
  expect(line.props.accessibilityActions).toEqual(SHARE_ACTION);

  await ReactTestRenderer.act(async () => {
    line.props.onAccessibilityAction({ nativeEvent: { actionName: 'share' } });
  });
  expect(mockShareLyric).toHaveBeenCalledWith(TRACK, 'words without time');

  await ReactTestRenderer.act(() => tree.unmount());
});
