import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import SearchScreen from '../src/screens/SearchScreen';
import { searchCatalog } from '../src/api/catalog';
import { LANGUAGES } from '../src/data/languages';
import { clearRecentSearches } from '../src/hooks/useRecentSearches';
import { closeSearch, setSearchQuery } from '../src/lib/searchQuery';

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
  getActiveExplicitOff: () => false,
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
  // The recents store is module-scoped — earlier tests' commits (playing a
  // result records the query) must not leak into the recents assertions.
  clearRecentSearches();
  // The search query/morph bus is module-scoped too (the top bar's floating
  // field and this screen share it) — reset so a query typed in one test
  // doesn't seed the next.
  closeSearch();
  searchCatalog.mockResolvedValue(RESULT);
});
afterEach(() => {
  jest.useRealTimers();
});

test('debounces, fetches categorized results and plays a song pick', async () => {
  const tree = render();

  await ReactTestRenderer.act(async () => {
    setSearchQuery('song');
  });
  expect(searchCatalog).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(600);
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

  await ReactTestRenderer.act(async () => {
    setSearchQuery('song');
  });
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(600);
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

test('offers every catalog language as a pill, not just onboarded ones', async () => {
  const tree = render();

  // 'all' + the canonical 14 in order (host views repeat each label; dedup).
  const pillLabels = [
    ...new Set(
      tree.root
        .findAll(
          n =>
            typeof n.props.accessibilityLabel === 'string' &&
            n.props.accessibilityLabel.startsWith('language '),
        )
        .map(n => n.props.accessibilityLabel),
    ),
  ];
  expect(pillLabels).toEqual(['all', ...LANGUAGES].map(L => `language ${L}`));

  await ReactTestRenderer.act(async () => {
    setSearchQuery('song');
  });
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(600);
  });

  // A language outside the user's onboarded pair still filters the query.
  const pill = byLabel(tree, 'language assamese');
  await ReactTestRenderer.act(async () => {
    pill.props.onPress();
  });
  expect(searchCatalog).toHaveBeenLastCalledWith('song', {
    lang: 'assamese',
    langs: ['tamil', 'english'],
    limit: 12,
  });

  await ReactTestRenderer.act(() => tree.unmount());
});

test('remembers only committed queries and re-runs them from recents', async () => {
  const tree = render();

  // An auto-fired as-you-type query alone leaves NO trace in recents —
  // that's what kept "mar"/"marand"/"marandhu" out of the list.
  await ReactTestRenderer.act(async () => {
    setSearchQuery('song');
  });
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(600);
  });
  await ReactTestRenderer.act(async () => {
    setSearchQuery('');
  });
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(600);
  });
  expect(texts(tree.toJSON())).not.toContain('recent searches');

  // Committing — tapping a result — is what records the query.
  await ReactTestRenderer.act(async () => {
    setSearchQuery('song');
  });
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(600);
  });
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'play Song One').props.onPress();
  });
  await ReactTestRenderer.act(async () => {
    setSearchQuery('');
  });
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(600);
  });
  expect(texts(tree.toJSON())).toContain('recent searches');

  const recent = byLabel(tree, 'search song');
  await ReactTestRenderer.act(async () => {
    recent.props.onPress();
  });
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(600);
  });
  expect(searchCatalog).toHaveBeenCalledTimes(3);

  await ReactTestRenderer.act(async () => {
    setSearchQuery('');
  });
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(600);
  });
  const clear = byLabel(tree, 'clear recent searches');
  await ReactTestRenderer.act(async () => {
    clear.props.onPress();
  });
  expect(texts(tree.toJSON())).not.toContain('recent searches');

  await ReactTestRenderer.act(() => tree.unmount());
});
