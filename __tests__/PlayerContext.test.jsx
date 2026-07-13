import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import { __getMockState, __resetMock } from 'react-native-track-player';
import { storage } from '../src/storage/mmkv';
import { clearSession } from '../src/lib/auth';
import { PlayerProvider, usePlayer } from '../src/playback/PlayerContext';

// Sign-out must tear playback down: the provider outlives App's auth flip, so
// the reset (not unmounting) is what stops the music and drops the queue.

function Probe() {
  const p = usePlayer();
  return <Text testID="current">{p.current ? p.current.id : 'none'}</Text>;
}

const currentId = tree =>
  tree.root.findByProps({ testID: 'current' }).props.children;

const flush = tree =>
  ReactTestRenderer.act(async () => {
    await new Promise(r => setTimeout(r, 0));
    return tree;
  });

describe('PlayerProvider sign-out reset', () => {
  beforeEach(() => {
    __resetMock();
    // Offline: the cold restore's getTrack calls fail and the restored queue
    // keeps its pending (streamUrl-less) tracks — enough for this test.
    global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
    storage.setItem('aura.authToken', 'jwt');
    storage.setItem('aura.authUser', JSON.stringify({ id: 1, name: 'aura' }));
    storage.setItem(
      'aura.queue',
      JSON.stringify({
        tracks: [
          { id: 't1', title: 'one' },
          { id: 't2', title: 'two' },
        ],
        idx: 0,
        source: "tonight's set",
      }),
    );
  });

  afterEach(() => {
    clearSession();
    delete global.fetch;
  });

  test('sign-out stops the engine, drops the queue and keeps storage clear', async () => {
    let tree;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <PlayerProvider>
          <Probe />
        </PlayerProvider>,
      );
    });
    await flush(tree);

    // Cold restore mirrored the persisted queue into the native player.
    expect(currentId(tree)).toBe('t1');
    expect(__getMockState().queue).toHaveLength(2);

    await ReactTestRenderer.act(async () => {
      clearSession();
    });
    await flush(tree);

    expect(currentId(tree)).toBe('none');
    expect(__getMockState().queue).toHaveLength(0);
    expect(__getMockState().playWhenReady).toBe(false);

    // The 400ms persist debounce must not resurrect the wiped queue key.
    await ReactTestRenderer.act(async () => {
      await new Promise(r => setTimeout(r, 450));
    });
    expect(storage.getItem('aura.queue')).toBeNull();

    await ReactTestRenderer.act(() => tree.unmount());
  });
});
