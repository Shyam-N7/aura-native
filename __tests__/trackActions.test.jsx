import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { TrackActionsSheet } from '../src/overlays/TrackActionsSheet';
import { openTrackActions } from '../src/lib/trackActionsSheet';
import { resetLikesStore } from '../src/hooks/useLikes';

const mockEnqueueNext = jest.fn();
const mockEnqueueLast = jest.fn();
const mockPlayTrack = jest.fn();
const mockOpenPlayer = jest.fn();
jest.mock('../src/playback/PlayerContext', () => ({
  usePlayer: () => ({
    playTrack: mockPlayTrack,
    enqueueNext: mockEnqueueNext,
    enqueueLast: mockEnqueueLast,
    ui: { playerOpen: false, openPlayer: mockOpenPlayer },
  }),
}));
jest.mock('../src/api/likes', () => ({
  listLikedIds: jest.fn(() => Promise.resolve([])),
  likeTrack: jest.fn(() => Promise.resolve()),
  unlikeTrack: jest.fn(() => Promise.resolve()),
}));

const TRACK = { id: 't1', title: 'Song', artist: 'A' };

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
  resetLikesStore();
});

test('opens from the bus, honors omit, runs an action, then closes', async () => {
  const tree = await render(<TrackActionsSheet />);
  expect(tree.toJSON()).toBeNull();

  await ReactTestRenderer.act(async () => {
    openTrackActions({ track: TRACK, menu: { omit: ['artist'] } });
  });
  expect(byLabel(tree, 'Play song')).toBeTruthy();
  expect(byLabel(tree, 'Add to queue')).toBeTruthy();
  expect(
    tree.root.findAllByProps({ accessibilityLabel: 'Open artist' }),
  ).toHaveLength(0);

  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'Play next').props.onPress();
  });
  expect(mockEnqueueNext).toHaveBeenCalledWith(TRACK);
  expect(tree.toJSON()).toBeNull();

  await ReactTestRenderer.act(() => tree.unmount());
});

test('play song plays live and opens the player', async () => {
  const tree = await render(<TrackActionsSheet />);
  await ReactTestRenderer.act(async () => {
    openTrackActions({ track: TRACK, menu: {} });
  });
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'Play song').props.onPress();
  });
  expect(mockPlayTrack).toHaveBeenCalledWith(TRACK, { source: 'your pick' });
  expect(mockOpenPlayer).toHaveBeenCalled();
  await ReactTestRenderer.act(() => tree.unmount());
});

test('a play override replaces the default single-track play', async () => {
  // Surfaces whose tap used to mean more than play-this-track (home's
  // more-like rail queues itself whole from the chosen tile) keep those
  // semantics inside the sheet.
  const play = jest.fn();
  const tree = await render(<TrackActionsSheet />);
  await ReactTestRenderer.act(async () => {
    openTrackActions({ track: TRACK, menu: { play } });
  });
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'Play song').props.onPress();
  });
  expect(play).toHaveBeenCalled();
  expect(mockPlayTrack).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => tree.unmount());
});

test('per-surface extras render below the base actions', async () => {
  const onPress = jest.fn();
  const tree = await render(<TrackActionsSheet />);
  await ReactTestRenderer.act(async () => {
    openTrackActions({
      track: TRACK,
      menu: {
        extras: [{ label: "Don't show this again", danger: true, onPress }],
      },
    });
  });
  await ReactTestRenderer.act(async () => {
    byLabel(tree, "Don't show this again").props.onPress();
  });
  expect(onPress).toHaveBeenCalled();
  await ReactTestRenderer.act(() => tree.unmount());
});
