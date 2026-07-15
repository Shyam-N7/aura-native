import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { LyricsOverlay } from '../src/overlays/LyricsOverlay';

jest.mock('react-native-track-player', () => ({
  useProgress: () => ({ position: 30, duration: 120, buffered: 0 }),
}));

const mockGetLyrics = jest.fn();
jest.mock('../src/api/lyrics', () => ({
  getLyrics: (...args) => mockGetLyrics(...args),
  prefetchLyrics: jest.fn(),
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
  expect(body).toContain("these lyrics aren't synced to the music.");
  await ReactTestRenderer.act(() => tree.unmount());
});

test('pending and unavailable states explain themselves', async () => {
  mockGetLyrics.mockResolvedValue({
    available: false,
    synced: false,
    pending: true,
  });
  let tree = await render();
  expect(texts(tree.toJSON())).toContain('syncing the lyrics…');
  await ReactTestRenderer.act(() => tree.unmount());

  mockGetLyrics.mockResolvedValue({ available: false, synced: false });
  tree = await render();
  expect(texts(tree.toJSON())).toContain("lyrics aren't available");
  await ReactTestRenderer.act(() => tree.unmount());
});
