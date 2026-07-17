import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { PlayerSheet } from '../src/overlays/PlayerSheet';
import { openQualitySheet } from '../src/lib/qualitySheet';
import { HINT_LIKE, HINT_NEXT, markHintDone } from '../src/lib/hints';
import { storage } from '../src/storage/mmkv';

jest.mock('../src/lib/qualitySheet', () => ({
  openQualitySheet: jest.fn(),
  closeQualitySheet: jest.fn(),
  subscribeQualitySheet: jest.fn(() => () => {}),
}));

jest.mock('react-native-track-player', () => ({
  useProgress: () => ({ position: 30, duration: 120, buffered: 0 }),
}));

// The real likes store boots with a network fetch on first use — a live TLS
// socket that can outlast the test process. The sheet only reads the shape.
jest.mock('../src/hooks/useLikes', () => ({
  useLikes: () => ({
    isLiked: () => false,
    like: jest.fn(async () => {}),
    unlike: jest.fn(async () => {}),
  }),
}));

// Mutable holder so each test can shape the player state before rendering.
const mockState = { player: null };
jest.mock('../src/playback/PlayerContext', () => ({
  usePlayer: () => mockState.player,
}));

const TRACK = {
  id: 't1',
  title: 'Current Song (From "Some Movie")',
  artist: 'someone',
  imageUrl: 'https://cdn/img_150x150.jpg',
  durationSec: 120,
};
const NEXT = { id: 't2', title: 'Next Song', artist: 'other' };

function basePlayer(overrides = {}) {
  return {
    current: TRACK,
    queue: { tracks: [TRACK, NEXT], idx: 0, source: 'more like this' },
    isPlaying: true,
    repeat: 'off',
    shuffleActive: false,
    quality: 'high',
    togglePlay: jest.fn(),
    next: jest.fn(),
    prev: jest.fn(),
    seekTo: jest.fn(),
    cycleRepeat: jest.fn(),
    toggleShuffle: jest.fn(),
    setQuality: jest.fn(),
    ui: {
      playerOpen: true,
      openPlayer: jest.fn(),
      closePlayer: jest.fn(),
      openQueue: jest.fn(),
    },
    ...overrides,
  };
}

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
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <PlayerSheet />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  storage.removeItem('aura.hintsDone');
});

test('gesture hints ride the art until each gesture has been performed', async () => {
  mockState.player = basePlayer();
  let tree = await render();
  let body = texts(tree.toJSON());
  expect(body).toContain('double-tap to like');
  expect(body).toContain('swipe up for next');
  await ReactTestRenderer.act(() => tree.unmount());

  // Both gestures learned — the chips are gone for good.
  markHintDone(HINT_LIKE);
  markHintDone(HINT_NEXT);
  tree = await render();
  body = texts(tree.toJSON());
  expect(body).not.toContain('double-tap to like');
  expect(body).not.toContain('swipe up for next');
  await ReactTestRenderer.act(() => tree.unmount());
});

test('renders nothing while the ui state is closed or missing', async () => {
  mockState.player = basePlayer({ ui: undefined });
  let tree = await render();
  expect(tree.toJSON()).toBeNull();
  await ReactTestRenderer.act(() => tree.unmount());

  mockState.player = basePlayer();
  mockState.player.ui.playerOpen = false;
  tree = await render();
  expect(tree.toJSON()).toBeNull();
  await ReactTestRenderer.act(() => tree.unmount());
});

test('shows the current track with transport, quality and up next', async () => {
  mockState.player = basePlayer();
  const p = mockState.player;
  const tree = await render();

  const body = texts(tree.toJSON());
  expect(body).toContain('Current Song');
  expect(body).toContain('someone');
  expect(body).toContain('Next Song');
  // 30s into 120s from the mocked progress ticker.
  expect(body).toContain('0:30');
  expect(body).toContain('-1:30');

  byLabel(tree, 'pause').props.onPress();
  expect(p.togglePlay).toHaveBeenCalled();
  byLabel(tree, 'next').props.onPress();
  expect(p.next).toHaveBeenCalled();
  byLabel(tree, 'previous').props.onPress();
  expect(p.prev).toHaveBeenCalled();
  byLabel(tree, 'shuffle').props.onPress();
  expect(p.toggleShuffle).toHaveBeenCalled();
  byLabel(tree, 'repeat off').props.onPress();
  expect(p.cycleRepeat).toHaveBeenCalled();

  // Quality is now a pill that opens the picker sheet (was inline chips).
  byLabel(tree, 'audio quality, high').props.onPress();
  expect(openQualitySheet).toHaveBeenCalled();

  byLabel(tree, 'close player').props.onPress();
  expect(p.ui.closePlayer).toHaveBeenCalledTimes(1);

  // "Up next" opens the queue sheet ABOVE the player — never closes it.
  byLabel(tree, 'up next, open queue').props.onPress();
  expect(p.ui.openQueue).toHaveBeenCalled();
  expect(p.ui.closePlayer).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(() => tree.unmount());
});
