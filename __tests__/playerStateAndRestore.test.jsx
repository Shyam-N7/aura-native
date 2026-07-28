import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { __resetMock } from 'react-native-track-player';
import { storage } from '../src/storage/mmkv';
import { clearSession } from '../src/lib/auth';
import { PlayerProvider, usePlayer } from '../src/playback/PlayerContext';

// Two silent failures of the provider:
//   · a PlaybackException leaves playWhenReady untouched, so nothing fired and
//     the UI reported "playing" for the whole recovery walk — up to ~80s of
//     silence behind a pause button and a frozen ribbon.
//   · the persisted queue was unversioned and unvalidated: an id-less row
//     restored as a PENDING_URL track that hydration skips and recovery
//     refetches by undefined id — permanently unplayable.

// Stand in for the service so the tests can deliver native events the way it
// does. The provider registers its handlers once, at boot.
const mockHandlers = {};
jest.mock('../src/playback/service', () => ({
  registerHandlers: next => Object.assign(mockHandlers, next),
}));

let api = null;
function Grab() {
  api = usePlayer();
  return null;
}

let tree = null;

const flush = () =>
  ReactTestRenderer.act(async () => {
    await new Promise(r => setTimeout(r, 0));
  });

const mount = async () => {
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <PlayerProvider>
        <Grab />
      </PlayerProvider>,
    );
  });
  await flush();
};

// The provider owns timers and an op chain; leaving it mounted lets its work
// outlive the test.
const unmount = async () => {
  if (!tree) {
    return;
  }
  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
  tree = null;
};

const storeQueue = payload =>
  storage.setItem('aura.queue', JSON.stringify(payload));

const readQueue = () => JSON.parse(storage.getItem('aura.queue') ?? 'null');

beforeEach(() => {
  __resetMock();
  api = null;
  Object.keys(mockHandlers).forEach(k => delete mockHandlers[k]);
  // Offline: the cold restore's getTrack calls fail and the restored tracks
  // stay pending, which is all these tests need.
  global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
  storage.setItem('aura.authToken', 'jwt');
  storage.setItem('aura.authUser', JSON.stringify({ id: 1, name: 'aura' }));
  storage.removeItem('aura.queue');
});

afterEach(async () => {
  await unmount();
  clearSession();
  delete global.fetch;
});

describe('PlayerProvider playback state', () => {
  const state = s =>
    ReactTestRenderer.act(async () => {
      mockHandlers.onPlaybackState({ state: s });
    });
  const playWhenReady = v =>
    ReactTestRenderer.act(async () => {
      mockHandlers.onPlayWhenReadyChanged({ playWhenReady: v });
    });

  beforeEach(() => {
    storeQueue({
      tracks: [
        { id: 't1', title: 'one' },
        { id: 't2', title: 'two' },
      ],
      idx: 0,
      source: 'your set',
    });
  });

  test('a playback error reads as not playing, all the way to audio coming back', async () => {
    await mount();
    await playWhenReady(true);
    expect(api.isPlaying).toBe(true);

    // The bug: playWhenReady is still true here — this is the only event that
    // says anything at all, and the UI used to ignore it.
    await state('error');
    expect(api.isPlaying).toBe(false);

    // Honest for the whole ladder, not just the first instant.
    await state('loading');
    expect(api.isPlaying).toBe(false);

    await state('playing');
    expect(api.isPlaying).toBe(true);
  });

  test('a mid-track rebuffer does not flicker the button', async () => {
    await mount();
    await playWhenReady(true);
    await state('buffering');
    expect(api.isPlaying).toBe(true);
  });

  test('a pause still belongs to playWhenReady', async () => {
    await mount();
    await playWhenReady(true);
    await playWhenReady(false);
    expect(api.isPlaying).toBe(false);
    // The paused state that follows must not fight it back on.
    await state('paused');
    expect(api.isPlaying).toBe(false);
  });
});

describe('PlayerProvider queue restore', () => {
  test('a queue saved before versioning still restores', async () => {
    storeQueue({
      tracks: [{ id: 't1' }, { id: 't2' }],
      idx: 1,
      source: 'your set',
    });
    await mount();
    expect(api.queue.tracks.map(t => t.id)).toEqual(['t1', 't2']);
    expect(api.current.id).toBe('t2');
  });

  test('a payload from a shape we do not know is dropped, not half-restored', async () => {
    storeQueue({ v: 99, tracks: [{ id: 't1' }], idx: 0, source: 'your set' });
    await mount();
    expect(api.queue.tracks).toHaveLength(0);
    expect(api.current).toBeNull();
  });

  test('id-less rows are dropped and the saved song stays the current one', async () => {
    storeQueue({
      v: 1,
      tracks: [{ title: 'ghost' }, { id: 't1' }, { id: 't2' }],
      idx: 2,
      source: 'your set',
    });
    await mount();
    expect(api.queue.tracks.map(t => t.id)).toEqual(['t1', 't2']);
    expect(api.current.id).toBe('t2');
  });

  test('the save stamps the version', async () => {
    storeQueue({
      tracks: [{ id: 't1' }, { id: 't2' }],
      idx: 0,
      source: 'your set',
    });
    await mount();
    await ReactTestRenderer.act(async () => {
      await new Promise(r => setTimeout(r, 450));
    });
    expect(readQueue().v).toBe(1);
  });

  test('unmount flushes the pending save instead of dropping it', async () => {
    storeQueue({
      tracks: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
      idx: 0,
      source: 'your set',
    });
    await mount();
    await ReactTestRenderer.act(async () => {
      api.removeAt(2);
      await new Promise(r => setTimeout(r, 0));
    });

    // Well inside the 400ms debounce: the old cleanup threw this write away,
    // so the next boot restored the queue the user had already edited.
    await unmount();
    expect(readQueue().tracks.map(t => t.id)).toEqual(['t1', 't2']);
  });
});
