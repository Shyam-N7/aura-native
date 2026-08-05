import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { useProgress } from 'react-native-track-player';
import { storage } from '../src/storage/mmkv';
import { usePlaybackProgress } from '../src/hooks/usePlaybackProgress';

jest.mock('react-native-track-player', () => ({
  useProgress: jest.fn(),
}));

// Playback is progressive — ExoPlayer holds a forward window rather than
// downloading a whole track — and RNTP already reports how far ahead it has
// loaded. The hook used to destructure that field out of existence, so the
// player had no way to show buffering at all.

function render() {
  let out;
  function Probe() {
    out = usePlaybackProgress(250);
    return null;
  }
  let tree;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<Probe />);
  });
  return {
    get: () => out,
    unmount: () => ReactTestRenderer.act(() => tree.unmount()),
  };
}

beforeEach(() => {
  storage.removeItem('aura.position');
  storage.removeItem('aura.queue');
  jest.clearAllMocks();
});

test('the buffered head reaches consumers as a fraction', () => {
  useProgress.mockReturnValue({ position: 30, duration: 200, buffered: 120 });

  const r = render();

  expect(r.get().buffered).toBe(120);
  expect(r.get().bufferedProgress).toBeCloseTo(0.6);
  r.unmount();
});

// It can read behind the playhead for a beat after a seek; drawn raw that
// would be a bar running backwards out of the thumb.
test('a buffered head behind the playhead is clamped forward', () => {
  useProgress.mockReturnValue({ position: 90, duration: 200, buffered: 10 });

  const r = render();

  expect(r.get().bufferedProgress).toBeCloseTo(0.45); // == progress, not 0.05
  r.unmount();
});

test('no duration yields no buffered fraction rather than NaN', () => {
  useProgress.mockReturnValue({ position: 0, duration: 0, buffered: 0 });

  const r = render();

  expect(r.get().bufferedProgress).toBe(0);
  r.unmount();
});

// The MMKV seed paints the last-known position before the native player has a
// queue. Nothing is loaded in that window, so claiming buffer would be a lie.
test('the cold-open seed reports nothing buffered', () => {
  storage.setItem(
    'aura.queue',
    JSON.stringify({ tracks: [{ id: 't1', durationSec: 200 }], idx: 0 }),
  );
  storage.setItem(
    'aura.position',
    JSON.stringify({ trackId: 't1', progress: 0.5 }),
  );
  useProgress.mockReturnValue({ position: 0, duration: 0, buffered: 0 });

  const r = render();

  expect(r.get().position).toBe(100); // seeded
  expect(r.get().buffered).toBe(0);
  expect(r.get().bufferedProgress).toBe(0);
  r.unmount();
});
