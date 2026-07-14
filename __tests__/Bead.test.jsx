import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { Bead } from '../src/components/player/Bead';

const mockState = { player: null };
jest.mock('../src/playback/PlayerContext', () => ({
  usePlayer: () => mockState.player,
}));
jest.mock('../src/hooks/usePlaybackProgress', () => ({
  usePlaybackProgress: () => ({ position: 30, duration: 120, progress: 0.25 }),
}));

const byLabel = (tree, accessibilityLabel) =>
  tree.root.findAllByProps({ accessibilityLabel })[0];

async function render() {
  let tree;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <Bead />
      </ThemeProvider>,
    );
  });
  return tree;
}

test('renders nothing without a loaded track', async () => {
  mockState.player = { current: null, isPlaying: false };
  const tree = await render();
  expect(tree.toJSON()).toBeNull();
  await ReactTestRenderer.act(() => tree.unmount());
});

test('wires play/pause and open player', async () => {
  mockState.player = {
    current: { id: 't1', title: 'Some Song', artist: 'someone' },
    isPlaying: false,
    togglePlay: jest.fn(),
    ui: { playerOpen: false, openPlayer: jest.fn() },
  };
  const tree = await render();

  byLabel(tree, 'play').props.onPress();
  expect(mockState.player.togglePlay).toHaveBeenCalled();

  // The bead measures itself for the morph origin; without a native host the
  // measure path falls back to a plain open call.
  byLabel(tree, 'open player').props.onPress();
  expect(mockState.player.ui.openPlayer).toHaveBeenCalled();

  await ReactTestRenderer.act(() => tree.unmount());
});
