import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import QueueScreen from '../src/screens/QueueScreen';

const mockJumpTo = jest.fn();
const mockRemoveAt = jest.fn();
const mockCycleRepeat = jest.fn();
const mockToggleShuffle = jest.fn();
const mockQueue = {
  tracks: [
    { id: 'a', title: 'First Song', artist: 'one', durationSec: 100 },
    { id: 'b', title: 'Second Song', artist: 'two', durationSec: 200 },
    { id: 'c', title: 'Third Song', artist: 'three', durationSec: 300 },
  ],
  idx: 1,
  source: 'more like this',
};
jest.mock('../src/playback/PlayerContext', () => ({
  usePlayer: () => ({
    current: mockQueue.tracks[1],
    queue: mockQueue,
    isPlaying: true,
    repeat: 'off',
    shuffleActive: false,
    jumpTo: mockJumpTo,
    removeAt: mockRemoveAt,
    cycleRepeat: mockCycleRepeat,
    toggleShuffle: mockToggleShuffle,
  }),
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
// First match is the composite Pressable (host views repeat its a11y props).
const byLabel = (tree, accessibilityLabel) =>
  tree.root.findAllByProps({ accessibilityLabel })[0];

test('lists the queue with source, count and row actions', async () => {
  const goBack = jest.fn();
  let tree;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <QueueScreen navigation={{ goBack }} />
      </ThemeProvider>,
    );
  });

  const body = texts(tree.toJSON());
  expect(body).toContain('more like this');
  expect(body).toContain('3 tracks');
  expect(body).toContain('now playing');

  // Tap a row → jump to that index.
  byLabel(tree, 'play Third Song').props.onPress();
  expect(mockJumpTo).toHaveBeenCalledWith(2);

  // The current row has no remove button; others do. (The list mounts from
  // initialScrollIndex, so row 0 may be virtualized away — use row 2.)
  byLabel(tree, 'remove Third Song').props.onPress();
  expect(mockRemoveAt).toHaveBeenCalledWith(2);
  expect(
    tree.root.findAllByProps({ accessibilityLabel: 'remove Second Song' }),
  ).toHaveLength(0);

  byLabel(tree, 'repeat off').props.onPress();
  expect(mockCycleRepeat).toHaveBeenCalled();
  byLabel(tree, 'shuffle').props.onPress();
  expect(mockToggleShuffle).toHaveBeenCalled();

  byLabel(tree, 'close queue').props.onPress();
  expect(goBack).toHaveBeenCalled();

  await ReactTestRenderer.act(() => tree.unmount());
});
