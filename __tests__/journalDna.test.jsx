import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import JournalScreen from '../src/screens/JournalScreen';
import DnaScreen from '../src/screens/DnaScreen';

const mockPlayTrack = jest.fn();
const mockOpenPlayer = jest.fn();
jest.mock('../src/playback/PlayerContext', () => ({
  usePlayer: () => ({
    playTrack: mockPlayTrack,
    ui: { openPlayer: mockOpenPlayer },
  }),
}));

const mockGetJournal = jest.fn();
jest.mock('../src/api/journal', () => ({
  getJournal: (...args) => mockGetJournal(...args),
}));
const mockGetSonicDna = jest.fn();
jest.mock('../src/api/sonicDna', () => ({
  getSonicDna: (...args) => mockGetSonicDna(...args),
}));
const mockGetTrack = jest.fn();
jest.mock('../src/api/catalog', () => ({
  getTrack: (...args) => mockGetTrack(...args),
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
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
}
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn() });

beforeEach(() => {
  jest.clearAllMocks();
});

test('journal renders entries and hydrates track-id strings into thumbs', async () => {
  mockGetJournal.mockResolvedValue({
    entries: [
      {
        date: '2026-07-14',
        label: 'Yesterday',
        tag: 'warm',
        headline: 'a slow tamil evening',
        body: 'you stayed with one artist for most of the night.',
        tracks: ['j1'],
      },
    ],
    totalEvents: 12,
  });
  mockGetTrack.mockResolvedValue({ id: 'j1', title: 'Journal Song', artist: 'a' });

  const tree = await render(<JournalScreen navigation={nav()} />);
  const body = texts(tree.toJSON());
  expect(body).toContain('your private listening journal');
  expect(body).toContain('Yesterday');
  expect(body).toContain('warm');
  expect(body).toContain('a slow tamil evening');
  expect(body).toContain('tracks heard');
  expect(mockGetTrack).toHaveBeenCalledWith('j1');

  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'play Journal Song').props.onPress();
  });
  expect(mockPlayTrack).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'j1' }),
    { source: 'your journal' },
  );
  expect(mockOpenPlayer).toHaveBeenCalled();
  await ReactTestRenderer.act(() => tree.unmount());
});

test('journal empty state waits honestly', async () => {
  mockGetJournal.mockResolvedValue({ entries: [], totalEvents: 0 });
  const tree = await render(<JournalScreen navigation={nav()} />);
  expect(texts(tree.toJSON())).toContain('your journal is waiting on you.');
  await ReactTestRenderer.act(() => tree.unmount());
});

test('dna renders axes, stats and real mood counts when available', async () => {
  mockGetSonicDna.mockResolvedValue({
    available: true,
    axes: [
      { label: 'pace', v: 0.7, range: 'slow · fast' },
      { label: 'warmth', v: 0.5, range: 'cool · warm' },
      { label: 'texture', v: 0.4, range: 'sparse · dense' },
    ],
    topMoods: [{ label: 'unwound', count: 21 }],
    thisMonth: { hours: 12, artists: 9, newTracks: 14, returns: 5 },
    signature: 'slow-burning tamil evenings',
    shift: 'drifting brighter',
    eventsSeen: 80,
  });
  const tree = await render(<DnaScreen navigation={nav()} />);
  const body = texts(tree.toJSON());
  expect(body).toContain('you, as a');
  expect(body).toContain('slow-burning tamil evenings · drifting brighter');
  expect(body).toContain('pace');
  expect(body).toContain('70');
  expect(body).toContain('this month · in numbers');
  expect(body).toContain('unique artists');
  expect(body).toContain('unwound');
  expect(body).toContain('21 plays');
  await ReactTestRenderer.act(() => tree.unmount());
});

test('dna unavailable state reads eventsSeen (the web read a field that never existed)', async () => {
  mockGetSonicDna.mockResolvedValue({
    available: false,
    eventsSeen: 4,
    threshold: 10,
  });
  const tree = await render(<DnaScreen navigation={nav()} />);
  const body = texts(tree.toJSON());
  expect(body).toContain('not enough listening yet.');
  expect(body).toContain("you're at 4/10 plays so far.");
  await ReactTestRenderer.act(() => tree.unmount());
});
