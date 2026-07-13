import React from 'react';
import { TextInput } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import SearchScreen from '../src/screens/SearchScreen';
import { searchCatalog } from '../src/api/catalog';

const mockPlayTrack = jest.fn();
const mockOpenPlayer = jest.fn();
jest.mock('../src/playback/PlayerContext', () => ({
  usePlayer: () => ({
    current: null,
    queue: { tracks: [], idx: -1, source: null },
    isPlaying: false,
    playTrack: mockPlayTrack,
    ui: { playerOpen: false, openPlayer: mockOpenPlayer },
  }),
}));
jest.mock('../src/lib/auth', () => ({
  getUser: () => ({
    name: 'aura',
    email: 'a@b.c',
    seedLanguages: ['tamil', 'english'],
  }),
}));
jest.mock('../src/api/catalog', () => ({
  searchCatalog: jest.fn(),
  getTrack: jest.fn(),
  getFeatured: jest.fn(),
}));

const SONG = {
  id: 't1',
  title: 'Song One (From "Some Movie")',
  artist: 'someone',
  imageUrl: 'https://cdn/img_150x150.jpg',
  durationSec: 200,
  language: 'tamil',
};
const RESULT = {
  top: null,
  songs: [SONG],
  artists: [{ id: 'a1', name: 'someone', image: null }],
  albums: [],
  playlists: [],
  userPlaylists: [],
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
// First match is the composite Pressable (host views repeat its a11y props).
const byLabel = (tree, accessibilityLabel) =>
  tree.root.findAllByProps({ accessibilityLabel })[0];

function render() {
  let tree;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <SearchScreen navigation={{ addListener: () => () => {} }} />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  searchCatalog.mockResolvedValue(RESULT);
});
afterEach(() => {
  jest.useRealTimers();
});

test('debounces, fetches categorized results and plays a song pick', async () => {
  const tree = render();
  const input = tree.root.findByType(TextInput);

  await ReactTestRenderer.act(async () => {
    input.props.onChangeText('song');
  });
  expect(searchCatalog).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(350);
  });
  expect(searchCatalog).toHaveBeenCalledWith('song', {
    lang: undefined,
    langs: ['tamil', 'english'],
    limit: 12,
  });

  // cleanTitle strips the (From "...") suffix in the row.
  const row = byLabel(tree, 'play Song One');
  await ReactTestRenderer.act(async () => {
    row.props.onPress();
  });
  expect(mockPlayTrack).toHaveBeenCalledWith(SONG, {
    source: 'your pick',
  });
  expect(mockOpenPlayer).toHaveBeenCalled();

  await ReactTestRenderer.act(() => tree.unmount());
});

test('language pill refetches with the lang filter', async () => {
  const tree = render();
  const input = tree.root.findByType(TextInput);

  await ReactTestRenderer.act(async () => {
    input.props.onChangeText('song');
  });
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(350);
  });

  const pill = byLabel(tree, 'language tamil');
  await ReactTestRenderer.act(async () => {
    pill.props.onPress();
  });
  expect(searchCatalog).toHaveBeenLastCalledWith('song', {
    lang: 'tamil',
    langs: ['tamil', 'english'],
    limit: 12,
  });

  await ReactTestRenderer.act(() => tree.unmount());
});

test('remembers matched queries and re-runs them from recents', async () => {
  const tree = render();
  const input = tree.root.findByType(TextInput);

  await ReactTestRenderer.act(async () => {
    input.props.onChangeText('song');
  });
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(350);
  });
  // Clearing the input surfaces the recents list.
  await ReactTestRenderer.act(async () => {
    input.props.onChangeText('');
  });
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(350);
  });
  expect(texts(tree.toJSON())).toContain('recent searches');

  const recent = byLabel(tree, 'search song');
  await ReactTestRenderer.act(async () => {
    recent.props.onPress();
  });
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(350);
  });
  expect(searchCatalog).toHaveBeenCalledTimes(2);

  await ReactTestRenderer.act(async () => {
    input.props.onChangeText('');
  });
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(350);
  });
  const clear = byLabel(tree, 'clear recent searches');
  await ReactTestRenderer.act(async () => {
    clear.props.onPress();
  });
  expect(texts(tree.toJSON())).not.toContain('recent searches');

  await ReactTestRenderer.act(() => tree.unmount());
});
