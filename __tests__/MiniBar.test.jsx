import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { MiniBar } from '../src/components/player/MiniBar';

const mockState = { player: null };
jest.mock('../src/playback/PlayerContext', () => ({
  usePlayer: () => mockState.player,
}));

const byLabel = (tree, accessibilityLabel) =>
  tree.root.findAllByProps({ accessibilityLabel })[0];

async function render() {
  let tree;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <MiniBar />
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

test('shows the track and wires play/pause + open player', async () => {
  mockState.player = {
    current: { id: 't1', title: 'Some Song', artist: 'someone' },
    isPlaying: false,
    togglePlay: jest.fn(),
    ui: { playerOpen: false, openPlayer: jest.fn() },
  };
  const tree = await render();

  const body = JSON.stringify(tree.toJSON());
  expect(body).toContain('Some Song');

  byLabel(tree, 'play').props.onPress();
  expect(mockState.player.togglePlay).toHaveBeenCalled();

  byLabel(tree, 'open player').props.onPress();
  expect(mockState.player.ui.openPlayer).toHaveBeenCalled();

  await ReactTestRenderer.act(() => tree.unmount());
});
