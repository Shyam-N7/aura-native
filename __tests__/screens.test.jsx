import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import HomeScreen from '../src/screens/HomeScreen';
import TalkScreen from '../src/screens/TalkScreen';
import YouScreen from '../src/screens/YouScreen';
import { getFeatured } from '../src/api/catalog';

const mockPlayQueue = jest.fn();
const mockOpenPlayer = jest.fn();
const mockSetQuality = jest.fn();
jest.mock('../src/playback/PlayerContext', () => ({
  usePlayer: () => ({
    current: null,
    queue: { tracks: [], idx: -1, source: null },
    isPlaying: false,
    quality: 'high',
    playQueue: mockPlayQueue,
    setQuality: mockSetQuality,
    ui: { playerOpen: false, openPlayer: mockOpenPlayer },
  }),
}));
jest.mock('../src/lib/auth', () => ({
  getUser: () => ({ name: 'Shyam N', email: 's@x.y' }),
  logout: jest.fn(),
}));
jest.mock('../src/api/catalog', () => ({
  searchCatalog: jest.fn(),
  getTrack: jest.fn(),
  getFeatured: jest.fn(),
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
});

test("home greets and plays tonight's set from featured", async () => {
  const tracks = [{ id: 't1', title: 'Song', artist: 'a' }];
  getFeatured.mockResolvedValue(tracks);
  const tree = await render(<HomeScreen />);

  const body = texts(tree.toJSON());
  expect(body).toMatch(/good (morning|afternoon|evening), shyam/);
  expect(body).toContain('arrive in the next build');

  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'play something').props.onPress();
  });
  expect(getFeatured).toHaveBeenCalledWith({ limit: 20 });
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
