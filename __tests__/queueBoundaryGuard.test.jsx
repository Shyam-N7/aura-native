import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import TrackPlayer, {
  __getMockState,
  __resetMock,
} from 'react-native-track-player';
import { storage } from '../src/storage/mmkv';
import { clearSession } from '../src/lib/auth';
import { PlayerProvider, usePlayer } from '../src/playback/PlayerContext';

// Every queue mutation is computed against the model's idea of what is
// playing. At a gapless boundary the native player has already advanced and
// its event lands a beat later — with the screen off, whole tracks later.
// Pushing the stale index makes syncQueue rebuild around a song that already
// finished, and the audio jumps backwards.

let api = null;
function Probe() {
  const p = usePlayer();
  api = p;
  return <Text testID="current">{p.current ? p.current.id : 'none'}</Text>;
}

const flush = () =>
  ReactTestRenderer.act(async () => {
    await new Promise(r => setTimeout(r, 0));
  });

let tree = null;
const mount = async () => {
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <PlayerProvider>
        <Probe />
      </PlayerProvider>,
    );
  });
  await flush();
  return tree;
};

beforeEach(() => {
  __resetMock();
  api = null;
  // Offline: the cold restore's getTrack calls fail and the restored tracks
  // stay pending, which is enough to exercise the queue mirror.
  global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
  storage.setItem('aura.authToken', 'jwt');
  storage.setItem('aura.authUser', JSON.stringify({ id: 1, name: 'aura' }));
  storage.setItem(
    'aura.queue',
    JSON.stringify({
      tracks: [
        { id: 't1', title: 'one' },
        { id: 't2', title: 'two' },
        { id: 't3', title: 'three' },
      ],
      idx: 0,
      source: 'your set',
    }),
  );
});

afterEach(async () => {
  // The provider owns timers and an op chain; leave it mounted and its work
  // outlives the test environment.
  if (tree) {
    await ReactTestRenderer.act(async () => {
      tree.unmount();
    });
    tree = null;
  }
  clearSession();
  delete global.fetch;
});

// The native player rolls into t2; JS has not heard about it yet.
const advanceNativeOnly = () =>
  ReactTestRenderer.act(async () => {
    await TrackPlayer.skip(1);
  });

test('removing a row at a boundary keeps the song that is actually playing', async () => {
  await mount();
  expect(__getMockState().queue.map(t => t.id)).toEqual(['t1', 't2', 't3']);

  await advanceNativeOnly();
  await ReactTestRenderer.act(async () => {
    api.removeAt(2);
  });
  await flush();

  const s = __getMockState();
  expect(s.queue.map(t => t.id)).toEqual(['t1', 't2']);
  // Without the guard this landed on t1 — the track that had just finished,
  // restarted from 0:00.
  expect(s.queue[s.activeIndex].id).toBe('t2');
});

test('reordering at a boundary does not rewind either', async () => {
  await mount();
  await advanceNativeOnly();

  await ReactTestRenderer.act(async () => {
    api.reorder(2, 0);
  });
  await flush();

  const s = __getMockState();
  expect(s.queue[s.activeIndex].id).toBe('t2');
});

test('add-to-queue at a boundary does not rewind either', async () => {
  await mount();
  await advanceNativeOnly();

  await ReactTestRenderer.act(async () => {
    api.enqueueLast({ id: 't4', title: 'four' });
  });
  await flush();

  const s = __getMockState();
  expect(s.queue.map(t => t.id)).toContain('t4');
  expect(s.queue[s.activeIndex].id).toBe('t2');
});

// The other face of the guard: the index READ can itself be wrong — a
// mid-rebuild transient — while nothing actually advanced. Trusting it
// recomputed the mutation around a song that was never playing and visibly
// stepped the now-playing row during a paused reorder (seen on-device).
// Drift must be confirmed by the active TRACK's id, not the index alone.
test('a transient native index while paused does not repoint the queue', async () => {
  await mount();
  expect(__getMockState().queue.map(t => t.id)).toEqual(['t1', 't2', 't3']);

  // The index read lies once; the active track still honestly reads t1.
  const spy = jest
    .spyOn(TrackPlayer, 'getActiveTrackIndex')
    .mockResolvedValueOnce(2);
  await ReactTestRenderer.act(async () => {
    api.reorder(2, 1);
  });
  await flush();
  spy.mockRestore();

  const s = __getMockState();
  expect(s.queue.map(t => t.id)).toEqual(['t1', 't3', 't2']);
  // Pre-fix this landed on t3: the guard recomputed around the transient and
  // skipped there. The song the user was on must not move.
  expect(s.queue[s.activeIndex].id).toBe('t1');
});

test('with no backlog the plain path still applies the edit', async () => {
  await mount();

  await ReactTestRenderer.act(async () => {
    api.removeAt(2);
  });
  await flush();

  const s = __getMockState();
  expect(s.queue.map(t => t.id)).toEqual(['t1', 't2']);
  expect(s.queue[s.activeIndex].id).toBe('t1');
});
