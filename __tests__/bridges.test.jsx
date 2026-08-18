import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import BridgesScreen from '../src/screens/BridgesScreen';
import { blendHex, loadCfg } from '../src/lib/bridges';
import { storage } from '../src/storage/mmkv';

const mockPlayQueue = jest.fn();
const mockOpenPlayer = jest.fn();
jest.mock('../src/playback/PlayerContext', () => ({
  usePlayer: () => ({
    playQueue: mockPlayQueue,
    ui: { openPlayer: mockOpenPlayer },
  }),
}));

const mockGetBridge = jest.fn();
const mockGetSuggestion = jest.fn();
jest.mock('../src/api/bridges', () => ({
  getBridge: (...a) => mockGetBridge(...a),
  getBridgeSuggestion: (...a) => mockGetSuggestion(...a),
}));
const mockShowToast = jest.fn();
jest.mock('../src/lib/toast', () => ({ showToast: (...a) => mockShowToast(...a) }));

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
        <BridgesScreen navigation={{ goBack: jest.fn() }} />
      </ThemeProvider>,
    );
  });
  return tree;
}

const TRACKS = [
  { id: 'a', title: 'One', artist: 'x', stepLabel: 'unwinding', imageUrl: null },
  { id: 'b', title: 'Two', artist: 'y', stepLabel: 'lifting', imageUrl: null },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSuggestion.mockResolvedValue({
    from: 'tired',
    to: 'energized',
    steps: 5,
    mood: 'tired',
    confidence: 0.7,
    reason: 'you sound worn down — here is the lift.',
    langs: [],
  });
  mockGetBridge.mockResolvedValue({
    from: 'tired',
    to: 'energized',
    narrative: 'a slow climb into brighter tempo.',
    tracks: TRACKS,
  });
});

test('the clairvoyant hero suggests and begins tonight’s journey', async () => {
  const tree = await render();
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  const body = texts(tree.toJSON());
  expect(body).toContain('Gradual paths between feelings');
  expect(body).toContain('The bridge already knows');
  expect(body).toContain('you sound worn down — here is the lift.');
  expect(mockGetSuggestion).toHaveBeenCalled();
  expect(mockGetBridge).toHaveBeenCalledWith(
    expect.objectContaining({ from: 'tired', to: 'energized' }),
  );

  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'Begin →').props.onPress();
  });
  expect(mockPlayQueue).toHaveBeenCalledWith(TRACKS, 0, 'tired → energized');
  expect(mockOpenPlayer).toHaveBeenCalled();

  await ReactTestRenderer.act(() => tree.unmount());
});

test('a classic preset curates for its moods and plays', async () => {
  const tree = await render();
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  mockGetBridge.mockClear();
  mockGetBridge.mockResolvedValue({ tracks: TRACKS });

  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'begin stressed to calm').props.onPress();
  });
  expect(mockGetBridge).toHaveBeenCalledWith(
    expect.objectContaining({ from: 'stressed', to: 'calm', steps: 6 }),
  );
  expect(mockPlayQueue).toHaveBeenCalledWith(TRACKS, 0, 'stressed → calm');

  await ReactTestRenderer.act(() => tree.unmount());
});

test('changing a mood invalidates the curated path back to a fresh preview', async () => {
  const tree = await render();
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  // Curate the default sad→happy path, then change the target mood.
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'Curate this path →').props.onPress();
  });
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
  });
  // Built now — the CTA reads "Begin →" for the custom path.
  expect(
    tree.root.findAllByProps({ accessibilityLabel: 'curate this path →' }),
  ).toHaveLength(0);
  // Switch the target to 'calm' → the curated result is dropped, CTA resets.
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'calm').props.onPress();
  });
  expect(byLabel(tree, 'Curate this path →')).toBeTruthy();
  await ReactTestRenderer.act(() => tree.unmount());
});

test('blendHex interpolates between two hex colours', () => {
  expect(blendHex('#000000', '#ffffff', 0.5)).toBe('rgb(128, 128, 128)');
  expect(blendHex('#ff0000', '#0000ff', 0)).toBe('rgb(255, 0, 0)');
  expect(blendHex('#ff0000', '#0000ff', 1)).toBe('rgb(0, 0, 255)');
});

test('loadCfg returns a valid default when storage is empty', () => {
  storage.removeItem('aura.moodBridge');
  const cfg = loadCfg();
  expect(cfg.from).toBe('sad');
  expect(cfg.to).toBe('happy');
  expect(cfg.steps).toBeGreaterThanOrEqual(4);
  expect(Array.isArray(cfg.langs)).toBe(true);
});
