import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import HomeScreen from '../src/screens/HomeScreen';
import TalkScreen from '../src/screens/TalkScreen';
import YouScreen from '../src/screens/YouScreen';
import { getFeatured } from '../src/api/catalog';
import { invalidateHomeCache } from '../src/lib/homeCache';

const mockPlayQueue = jest.fn();
const mockPlayTrack = jest.fn();
const mockOpenPlayer = jest.fn();
const mockSetQuality = jest.fn();
jest.mock('../src/playback/PlayerContext', () => ({
  usePlayer: () => ({
    current: null,
    queue: { tracks: [], idx: -1, source: null },
    isPlaying: false,
    quality: 'high',
    playQueue: mockPlayQueue,
    playTrack: mockPlayTrack,
    setQuality: mockSetQuality,
    ui: { playerOpen: false, openPlayer: mockOpenPlayer },
  }),
}));
jest.mock('../src/lib/auth', () => ({
  getUser: () => ({ name: 'Shyam N', email: 's@x.y' }),
  getActiveExplicitOff: () => false,
  logout: jest.fn(),
}));
jest.mock('../src/api/catalog', () => ({
  searchCatalog: jest.fn(),
  getTrack: jest.fn(),
  getFeatured: jest.fn(),
}));
// Home section fetches — empty by default so sections self-hide and the
// featured pool (mocked above) feeds the quick-picks fallback chain.
jest.mock('../src/api/quickPicks', () => ({
  getQuickPicks: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../src/api/stats', () => ({
  getMostPlayed: jest.fn(() => Promise.resolve([])),
  getTopArtists: jest.fn(() => Promise.resolve([])),
  getRecentlyPlayed: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../src/api/playlists', () => ({
  listPlaylists: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../src/api/autoPlaylists', () => ({
  listAutoPlaylists: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../src/api/discover', () => ({
  getDiscoverHome: jest.fn(() => Promise.resolve({ popularPlaylists: [] })),
}));
jest.mock('../src/api/impressions', () => ({
  logImpressions: jest.fn(),
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
  invalidateHomeCache();
});

test("home greets and begins tonight's set from the hero band", async () => {
  const tracks = [
    {
      id: 't1',
      title: 'Song',
      artist: 'a',
      imageUrl: 'https://c/i_150x150.jpg',
    },
    { id: 't2', title: 'Other', artist: 'b' },
  ];
  getFeatured.mockResolvedValue(tracks);
  const tree = await render(<HomeScreen />);

  const body = texts(tree.toJSON());
  expect(body).toMatch(/good (morning|afternoon|evening), shyam/);
  expect(body).toContain('music that gets your mood');
  expect(getFeatured).toHaveBeenCalledWith({ limit: 24 });

  // The pool feeds the quick-picks fallback — the wheel renders its discs.
  expect(byLabel(tree, 'play Song')).toBeTruthy();

  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'begin the set').props.onPress();
  });
  expect(mockPlayQueue).toHaveBeenCalledWith(tracks, 0, "tonight's set");
  expect(mockOpenPlayer).toHaveBeenCalled();

  await ReactTestRenderer.act(() => tree.unmount());
});

test('talk is an honest placeholder', async () => {
  const tree = await render(<TalkScreen />);
  expect(texts(tree.toJSON())).toContain('coming in the next build');
  await ReactTestRenderer.act(() => tree.unmount());
});

test('you shows identity, quality picker and sign out', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const tree = await render(<YouScreen />);

  const body = texts(tree.toJSON());
  expect(body).toContain('Shyam N');
  expect(body).toContain('s@x.y');
  expect(body).toContain('phase 1');

  byLabel(tree, 'quality low').props.onPress();
  expect(mockSetQuality).toHaveBeenCalledWith('low');

  byLabel(tree, 'sign out').props.onPress();
  expect(alertSpy).toHaveBeenCalled();

  alertSpy.mockRestore();
  await ReactTestRenderer.act(() => tree.unmount());
});
