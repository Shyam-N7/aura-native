import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import TrackPlayer, {
  __getMockState,
  __resetMock,
  __setProgress,
} from 'react-native-track-player';
import { storage } from '../src/storage/mmkv';
import { clearSession } from '../src/lib/auth';
import { PlayerProvider, usePlayer } from '../src/playback/PlayerContext';

// Ordering guarantees around the op chain. Every queue intent applies its
// mutation synchronously on press so the NEXT press reads an updated queueRef;
// anything that defers that write until the op runs reads stale state and
// writes a stale snapshot back over whatever landed in between.

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
        { id: 't4', title: 'four' },
      ],
      idx: 3,
      source: 'your set',
    }),
  );
});

afterEach(async () => {
  if (tree) {
    await ReactTestRenderer.act(async () => {
      tree.unmount();
    });
    tree = null;
  }
  clearSession();
  delete global.fetch;
});

// The bug: prev() captured the queue AND computed its target at press time but
// only applied them inside the op, after the chain drained. Two presses in the
// same tick therefore both read idx 3, both computed 2, and the user went back
// one track instead of two. Every sibling intent applies on press; prev was the
// only one that did not.
test('a double-tap of previous steps back two tracks, not one', async () => {
  await mount();
  // Early in the track, so previous STEPS rather than restarting.
  __setProgress({ position: 0.5 });
  expect(api.queue.idx).toBe(3);

  await ReactTestRenderer.act(async () => {
    api.prev();
    api.prev();
  });
  await flush();

  expect(api.queue.idx).toBe(1);
  expect(__getMockState().queue[__getMockState().activeIndex].id).toBe('t2');
});

// Past the restart threshold a previous press restarts the current track and
// must not move the queue at all — the behaviour the step-back shares an op
// with, pinned so recomputing inside the op cannot regress it.
test('previous past the threshold restarts without moving the queue', async () => {
  await mount();
  __setProgress({ position: 30 });

  await ReactTestRenderer.act(async () => {
    api.prev();
  });
  await flush();

  expect(api.queue.idx).toBe(3);
});

// An INVARIANT, not a regression test: I could not construct a case where two
// queued edits diverge, because the second op's own drift correction happens to
// re-derive the first from its captured `before`. The divergence the rewrite
// closes needs a model change that carries no op of its own — a hydration fill
// or a wake resync — which this harness cannot schedule deterministically.
// Pinned anyway: model and native must agree after edits at a boundary.
test('model and native agree after two edits at a boundary', async () => {
  await mount();
  expect(__getMockState().queue.map(t => t.id)).toEqual([
    't1',
    't2',
    't3',
    't4',
  ]);

  // The native player rolls on; JS has not heard about it yet.
  await ReactTestRenderer.act(async () => {
    await TrackPlayer.skip(0);
  });

  // Two edits in one tick: the first op hits the drift guard, the second is
  // still queued behind it.
  await ReactTestRenderer.act(async () => {
    api.removeAt(3);
    api.removeAt(2);
  });
  await flush();

  const native = __getMockState().queue.map(t => t.id);
  // Both removals survive...
  expect(native).toEqual(['t1', 't2']);
  // ...and the model agrees with the native queue. Pre-fix the model kept t3
  // (the drift correction rebuilt from the pre-second-edit snapshot) while the
  // native queue had dropped it.
  expect(api.queue.tracks.map(t => t.id)).toEqual(native);
});

// The guard's original contract, re-pinned against the rewritten correction:
// the song actually playing must stay the active one.
test('the drift correction still lands on the song that is playing', async () => {
  await mount();
  await ReactTestRenderer.act(async () => {
    await TrackPlayer.skip(0);
  });

  await ReactTestRenderer.act(async () => {
    api.removeAt(3);
  });
  await flush();

  const s = __getMockState();
  expect(s.queue[s.activeIndex].id).toBe('t1');
});

// replaceTrack resolves its index against the MODEL before being enqueued, so
// by the time it runs the native row at that index may be a different song —
// the auto-quality sampler's remapQueue rewrites the native queue from a 5s
// timer that rides no op chain at all. A bounds check cannot tell the two
// apart; the id can.
describe('replaceTrack identity guard', () => {
  const engine = require('../src/playback/engine');

  beforeEach(async () => {
    __resetMock();
    await TrackPlayer.setQueue([
      { id: 't1', url: 'u1' },
      { id: 't2', url: 'u2' },
      { id: 't3', url: 'u3' },
    ]);
  });

  test('a slot holding a different track is left alone', async () => {
    await engine.replaceTrack(1, {
      id: 'someone-else',
      streamUrl: 'https://cdn/x_160.mp4',
    });

    // Pre-fix this removed t2 and spliced the wrong song into its place.
    expect(__getMockState().queue.map(t => t.id)).toEqual(['t1', 't2', 't3']);
  });

  test('the matching slot is still replaced', async () => {
    await engine.replaceTrack(1, {
      id: 't2',
      title: 'two',
      streamUrl: 'https://cdn/two_160.mp4',
    });

    const q = __getMockState().queue;
    expect(q.map(t => t.id)).toEqual(['t1', 't2', 't3']);
    expect(q[1].url).toContain('two');
  });
});
