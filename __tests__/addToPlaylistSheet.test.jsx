import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { AddToPlaylistSheet } from '../src/overlays/AddToPlaylistSheet';
import { openAddToPlaylist } from '../src/lib/addToPlaylistSheet';

const mockListPlaylists = jest.fn();
const mockGetPlaylist = jest.fn();
const mockAddToPlaylist = jest.fn();
const mockCreatePlaylist = jest.fn();
jest.mock('../src/api/playlists', () => ({
  listPlaylists: (...a) => mockListPlaylists(...a),
  getPlaylist: (...a) => mockGetPlaylist(...a),
  addToPlaylist: (...a) => mockAddToPlaylist(...a),
  createPlaylist: (...a) => mockCreatePlaylist(...a),
}));
const mockShowToast = jest.fn();
jest.mock('../src/lib/toast', () => ({
  showToast: (...a) => mockShowToast(...a),
}));

const byLabel = (tree, accessibilityLabel) =>
  tree.root.findAllByProps({ accessibilityLabel })[0];

async function render() {
  let tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <AddToPlaylistSheet />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListPlaylists.mockResolvedValue([
    { id: 'p1', name: 'Chill', trackCount: 3, coverImageUrl: null },
    { id: 'p2', name: 'Workout', trackCount: 5, coverImageUrl: null },
  ]);
  // p1 already has the track; p2 does not.
  mockGetPlaylist.mockImplementation(id =>
    Promise.resolve({
      id,
      tracks: id === 'p1' ? [{ id: 'trk' }] : [{ id: 'other' }],
    }),
  );
  mockAddToPlaylist.mockResolvedValue();
});

const TRACK = { id: 'trk', title: 'A Song', artist: 'x' };

test('ticks the playlist that already holds the track and never re-adds it', async () => {
  const tree = await render();
  await ReactTestRenderer.act(async () => {
    openAddToPlaylist(TRACK);
  });
  // Let the membership reads (getPlaylist per playlist) settle.
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  // p1 shows as already-in (no add affordance); p2 is still addable.
  expect(byLabel(tree, 'in Chill')).toBeTruthy();
  expect(byLabel(tree, 'add to Chill')).toBeUndefined();
  expect(byLabel(tree, 'add to Workout')).toBeTruthy();

  // Tapping the already-in row is a silent no-op — no add call, no toast.
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'in Chill').props.onPress();
  });
  expect(mockAddToPlaylist).not.toHaveBeenCalled();
  expect(mockShowToast).not.toHaveBeenCalled();

  await ReactTestRenderer.act(() => tree.unmount());
});

test('a not-yet-containing playlist still adds and confirms', async () => {
  const tree = await render();
  await ReactTestRenderer.act(async () => {
    openAddToPlaylist(TRACK);
  });
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'add to Workout').props.onPress();
  });
  expect(mockAddToPlaylist).toHaveBeenCalledWith('p2', 'trk');
  expect(mockShowToast).toHaveBeenCalledWith('Added to Workout.', { tick: true });

  await ReactTestRenderer.act(() => tree.unmount());
});
