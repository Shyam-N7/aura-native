import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { confirm } from '../src/lib/confirm';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { storage } from '../src/storage/mmkv';
import { QueueSheet } from '../src/overlays/QueueSheet';

jest.mock('react-native-track-player', () => ({
  useProgress: () => ({ position: 30, duration: 120, buffered: 0 }),
}));

const mockJumpTo = jest.fn();
const mockRemoveAt = jest.fn();
const mockCycleRepeat = jest.fn();
const mockToggleShuffle = jest.fn();
const mockClearQueue = jest.fn();
const mockCloseQueue = jest.fn();
const mockQueue = {
  tracks: [
    { id: 'a', title: 'First Song', artist: 'one', durationSec: 100 },
    { id: 'b', title: 'Second Song', artist: 'two', durationSec: 200 },
    { id: 'c', title: 'Third Song', artist: 'three', durationSec: 300 },
  ],
  idx: 1,
  source: 'more like this',
};
// Mutable so the closed-state test can flip queueOpen before rendering.
const mockState = { queueOpen: true };
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
    clearQueue: mockClearQueue,
    ui: { queueOpen: mockState.queueOpen, closeQueue: mockCloseQueue },
  }),
}));

const mockOpenAddToPlaylist = jest.fn();
jest.mock('../src/lib/addToPlaylistSheet', () => ({
  openAddToPlaylist: (...a) => mockOpenAddToPlaylist(...a),
}));
const mockCreatePlaylist = jest.fn();
const mockAddToPlaylist = jest.fn();
jest.mock('../src/api/playlists', () => ({
  createPlaylist: (...a) => mockCreatePlaylist(...a),
  addToPlaylist: (...a) => mockAddToPlaylist(...a),
}));
const mockShowToast = jest.fn();
jest.mock('../src/lib/confirm', () => ({
  confirm: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('../src/lib/toast', () => ({
  showToast: (...a) => mockShowToast(...a),
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

async function render() {
  let tree;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <QueueSheet />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockState.queueOpen = true;
  storage.removeItem('aura.queueHidePast');
});

test('renders nothing while the queue ui state is closed', async () => {
  mockState.queueOpen = false;
  const tree = await render();
  expect(tree.toJSON()).toBeNull();
  await ReactTestRenderer.act(() => tree.unmount());
});

test('lists the queue with source, count and row actions', async () => {
  // Fake timers for the WHOLE test (house pattern — SearchScreen/WhatsNew):
  // flipping them on mid-test strands the frame-callback registrations the
  // reanimated mock deferred at mount, and the advance then crashes its
  // registry. One timer implementation end to end keeps the mock coherent.
  jest.useFakeTimers();
  const tree = await render();
  // Land the open spring first — rows mount only after the sheet settles.
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(800);
  });

  const body = texts(tree.toJSON());
  expect(body).toContain('more like this');
  expect(body).toContain('3 tracks');
  expect(body).toContain('Now playing');

  // Tap a row → jump to that index.
  byLabel(tree, 'play Third Song').props.onPress();
  expect(mockJumpTo).toHaveBeenCalledWith(2);

  // The current row has no remove button; others do. (The list mounts from
  // initialScrollIndex, so row 0 may be virtualized away — use row 2.)
  // Removal is animate-then-commit: the tap starts the row's storm-off in
  // place, and the queue is only touched once the exit has finished.
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'remove Third Song').props.onPress();
  });
  expect(mockRemoveAt).not.toHaveBeenCalled();
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(600);
  });
  expect(mockRemoveAt).toHaveBeenCalledWith(2);
  expect(
    tree.root.findAllByProps({ accessibilityLabel: 'remove Second Song' }),
  ).toHaveLength(0);

  byLabel(tree, 'repeat off').props.onPress();
  expect(mockCycleRepeat).toHaveBeenCalled();
  byLabel(tree, 'Shuffle').props.onPress();
  expect(mockToggleShuffle).toHaveBeenCalled();

  // Closing the sheet flips the ui state — the player underneath stays put.
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'close queue').props.onPress();
  });
  expect(mockCloseQueue).toHaveBeenCalled();

  await ReactTestRenderer.act(() => tree.unmount());
  jest.useRealTimers();
});

const openMenu = tree =>
  ReactTestRenderer.act(async () => {
    byLabel(tree, 'queue options').props.onPress();
  });

test('queue options menu lists every action with plain labels', async () => {
  const tree = await render();
  await openMenu(tree);

  expect(byLabel(tree, 'Save queue as playlist')).toBeTruthy();
  expect(byLabel(tree, 'Add queue to playlist')).toBeTruthy();
  expect(byLabel(tree, 'Hide past songs')).toBeTruthy();
  expect(byLabel(tree, 'Clear queue')).toBeTruthy();

  // "Add queue to playlist" hands over the WHOLE queue — past and current
  // included, hide-past never filters it (web parity).
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'Add queue to playlist').props.onPress();
  });
  expect(mockOpenAddToPlaylist).toHaveBeenCalledWith(mockQueue.tracks);

  await ReactTestRenderer.act(() => tree.unmount());
});

test('clear queue confirms first, then clears through the player context', async () => {
  const tree = await render();
  await openMenu(tree);

  // Declining the house confirm leaves the queue alone.
  confirm.mockResolvedValueOnce(false);
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'Clear queue').props.onPress();
  });
  expect(confirm).toHaveBeenCalledWith({
    title: 'Clear queue?',
    body: "We'll keep the currently playing track.",
    action: 'Clear',
  });
  expect(mockClearQueue).not.toHaveBeenCalled();

  // Accepting clears through the player context.
  await openMenu(tree);
  confirm.mockResolvedValueOnce(true);
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'Clear queue').props.onPress();
  });
  expect(mockClearQueue).toHaveBeenCalled();

  await ReactTestRenderer.act(() => tree.unmount());
});

test('save queue as playlist creates it and adds every queue track', async () => {
  mockCreatePlaylist.mockResolvedValue({ id: 'p9', name: 'my queue' });
  mockAddToPlaylist.mockResolvedValue();
  const tree = await render();
  await openMenu(tree);

  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'Save queue as playlist').props.onPress();
  });
  // The name step opens EMPTY (web parity: naming is a conscious act) — a
  // bare save must be a no-op, not a playlist literally called "my queue".
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'save').props.onPress();
    await new Promise(r => setTimeout(r, 0));
  });
  expect(mockCreatePlaylist).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'playlist name').props.onChangeText('my queue');
  });
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'save').props.onPress();
    await new Promise(r => setTimeout(r, 0));
  });

  expect(mockCreatePlaylist).toHaveBeenCalledWith({ name: 'my queue' });
  expect(mockAddToPlaylist.mock.calls).toEqual([
    ['p9', 'a'],
    ['p9', 'b'],
    ['p9', 'c'],
  ]);
  expect(mockShowToast).toHaveBeenCalledWith('saved.', { tick: true });

  await ReactTestRenderer.act(() => tree.unmount());
});

test('hide past songs trims rows before the current track, keeping queue indices', async () => {
  // Whole-test fake timers — see 'lists the queue' for why.
  jest.useFakeTimers();
  const tree = await render();
  // Land the open spring — rows mount only after the sheet settles.
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(800);
  });
  await openMenu(tree);
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'Hide past songs').props.onPress();
  });

  // The past row is gone and the header counts what is visible.
  const body = texts(tree.toJSON());
  expect(body).not.toContain('First Song');
  expect(body).toContain('2 tracks');

  // Visible rows still act on ABSOLUTE queue indices — the removal commit
  // resolves its key over the visible slice, then addresses the real queue.
  byLabel(tree, 'play Third Song').props.onPress();
  expect(mockJumpTo).toHaveBeenCalledWith(2);
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'remove Third Song').props.onPress();
  });
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(600);
  });
  expect(mockRemoveAt).toHaveBeenCalledWith(2);

  // The row label reflects state and toggles the rows back.
  await openMenu(tree);
  expect(byLabel(tree, 'Hide past songs')).toBeUndefined();
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'Show past songs').props.onPress();
  });
  expect(texts(tree.toJSON())).toContain('First Song');
  expect(texts(tree.toJSON())).toContain('3 tracks');

  await ReactTestRenderer.act(() => tree.unmount());
  jest.useRealTimers();
});

test('hide past persists across opens via the mmkv pref', async () => {
  jest.useFakeTimers();
  storage.setItem('aura.queueHidePast', '1');
  const tree = await render();
  // Land the open spring — rows mount only after the sheet settles.
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(800);
  });

  const body = texts(tree.toJSON());
  expect(body).not.toContain('First Song');
  expect(body).toContain('2 tracks');

  await ReactTestRenderer.act(() => tree.unmount());
  jest.useRealTimers();
});
