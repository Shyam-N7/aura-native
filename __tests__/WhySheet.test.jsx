import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { WhySheet } from '../src/overlays/WhySheet';
import { openWhy, closeWhy } from '../src/lib/whySheet';

const mockGetWhy = jest.fn();
jest.mock('../src/api/why', () => ({
  getWhy: (...args) => mockGetWhy(...args),
}));
const mockGetCurrentMood = jest.fn();
jest.mock('../src/api/mood', () => ({
  getCurrentMood: (...args) => mockGetCurrentMood(...args),
}));

const TRACK = { id: 'w1', title: 'Some Song (From "A Film")', artist: 'a' };

const REASON = {
  headline: 'built for a slow evening',
  body: 'it keeps the pace you have been holding all night.',
  dimensions: [
    { label: 'pace', value: 'slow burn, 78bpm feel', strength: 0.8 },
    { label: 'warmth', value: 'tamil, familiar voice', strength: 0.6 },
    { label: 'hour', value: 'late evening fit', strength: 0.4 },
  ],
  considered: [{ title: 'Other Song', artist: 'b', why: 'too bright for now' }],
  confidence: 0.72,
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

async function render() {
  let tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <WhySheet />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetCurrentMood.mockResolvedValue({ mood: 'unwound', confidence: 0.8 });
  mockGetWhy.mockResolvedValue(REASON);
});

afterEach(() => {
  ReactTestRenderer.act(() => closeWhy());
});

test('renders nothing until a track is published', async () => {
  const tree = await render();
  expect(tree.toJSON()).toBeNull();
  expect(mockGetWhy).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => tree.unmount());
});

test('reasons about the published track with the confident mood attached', async () => {
  const tree = await render();
  await ReactTestRenderer.act(async () => {
    openWhy(TRACK);
  });

  expect(mockGetWhy).toHaveBeenCalledWith(
    expect.objectContaining({ trackId: 'w1', mood: 'unwound' }),
  );
  const body = texts(tree.toJSON());
  expect(body).toContain('why this song');
  expect(body).toContain('built for a slow evening');
  expect(body).toContain('matched on');
  expect(body).toContain('pace');
  expect(body).toContain('80%');
  expect(body).toContain('considered · ruled out');
  expect(body).toContain('too bright for now');
  expect(body).toContain('confidence');
  expect(body).toContain('72');

  await ReactTestRenderer.act(() => tree.unmount());
});

test('a thin mood read reasons mood-free instead of guessing', async () => {
  mockGetCurrentMood.mockResolvedValue({ mood: 'unwound', confidence: 0.2 });
  const tree = await render();
  await ReactTestRenderer.act(async () => {
    openWhy(TRACK);
  });
  expect(mockGetWhy).toHaveBeenCalledWith(
    expect.objectContaining({ trackId: 'w1', mood: undefined }),
  );
  await ReactTestRenderer.act(() => tree.unmount());
});

test('a failed reasoning shows the honest error state', async () => {
  mockGetWhy.mockRejectedValue(new Error('model unavailable'));
  const tree = await render();
  await ReactTestRenderer.act(async () => {
    openWhy(TRACK);
  });
  const body = texts(tree.toJSON());
  expect(body).toContain("couldn't reason");
  expect(body).toContain('model unavailable');
  await ReactTestRenderer.act(() => tree.unmount());
});
