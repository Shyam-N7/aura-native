import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import TalkScreen from '../src/screens/TalkScreen';
import { _resetTalkStore } from '../src/hooks/useTalkHistory';

const mockPlayQueue = jest.fn();
const mockOpenPlayer = jest.fn();
jest.mock('../src/playback/PlayerContext', () => ({
  usePlayer: () => ({
    current: null,
    playQueue: mockPlayQueue,
    ui: { openPlayer: mockOpenPlayer },
  }),
}));
jest.mock('../src/lib/auth', () => ({
  getModeEpoch: () => 0,
  getUser: () => ({ name: 'Shyam N', email: 's@x.y' }),
}));

const mockTalk = jest.fn();
jest.mock('../src/api/talk', () => ({
  talk: (...args) => mockTalk(...args),
}));
const mockGetCurrentMood = jest.fn();
jest.mock('../src/api/mood', () => ({
  getCurrentMood: (...args) => mockGetCurrentMood(...args),
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

async function render() {
  let tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <TalkScreen navigation={{ navigate: jest.fn() }} />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetTalkStore();
  mockGetCurrentMood.mockResolvedValue({ mood: 'unwound', confidence: 0.8 });
});

test('greets with the live mood reading when the server is confident', async () => {
  const tree = await render();
  const body = texts(tree.toJSON());
  expect(body).toContain("I'm reading you as unwound right now");
  expect(body).toContain('Take me somewhere quieter');
  await ReactTestRenderer.act(() => tree.unmount());
});

test('falls back to a plain invitation when the mood read is thin', async () => {
  mockGetCurrentMood.mockResolvedValue({ mood: null, confidence: 0 });
  const tree = await render();
  expect(texts(tree.toJSON())).toContain(
    'Tell me what you want to hear, how you feel, or where to take you next.',
  );
  await ReactTestRenderer.act(() => tree.unmount());
});

test('a turn sends history + mood, renders the reply and its play set', async () => {
  const tracks = [
    { id: 'x1', title: 'Song One', artist: 'a' },
    { id: 'x2', title: 'Song Two', artist: 'b' },
  ];
  mockTalk.mockResolvedValue({
    reply: 'shifting the set quieter.',
    action: { kind: 'queue', query: 'quiet tamil', count: 2 },
    tracks,
    suggestions: ['keep it acoustic'],
  });
  const tree = await render();

  // Suggestion chips are one-tap sends.
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'Take me somewhere quieter').props.onPress();
  });
  expect(mockTalk).toHaveBeenCalledWith({
    message: 'Take me somewhere quieter',
    history: expect.arrayContaining([
      expect.objectContaining({ who: 'aura' }),
      { who: 'you', text: 'Take me somewhere quieter' },
    ]),
    context: { mood: 'unwound' },
  });

  const body = texts(tree.toJSON());
  expect(body).toContain('shifting the set quieter.');
  expect(body).toContain('Play set · 2');
  // The reply's suggestions replace the static chips.
  expect(body).toContain('keep it acoustic');

  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'play set of 2').props.onPress();
  });
  expect(mockPlayQueue).toHaveBeenCalledWith(tracks, 0, 'suggested for you');
  expect(mockOpenPlayer).toHaveBeenCalled();

  await ReactTestRenderer.act(() => tree.unmount());
});

test('a failed turn stays in the thread as an honest error line', async () => {
  mockTalk.mockRejectedValue(new Error('rate limited'));
  const tree = await render();
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'I need to focus').props.onPress();
  });
  expect(texts(tree.toJSON())).toContain(
    "Couldn't reach the dj — rate limited",
  );
  await ReactTestRenderer.act(() => tree.unmount());
});

test('clear resets the conversation and re-greets', async () => {
  mockTalk.mockResolvedValue({ reply: 'ok.', tracks: null, suggestions: [] });
  const tree = await render();
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'Play tamil indie').props.onPress();
  });
  expect(texts(tree.toJSON())).toContain('ok.');

  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'clear conversation').props.onPress();
  });
  const body = texts(tree.toJSON());
  expect(body).not.toContain('ok.');
  expect(body).toContain("I'm reading you as unwound right now");

  await ReactTestRenderer.act(() => tree.unmount());
});
