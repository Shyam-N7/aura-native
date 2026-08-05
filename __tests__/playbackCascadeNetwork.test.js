import TrackPlayer, {
  __getMockState,
  __resetMock,
} from 'react-native-track-player';
import {
  MAX_CONSECUTIVE_SKIPS,
  handlePlaybackError,
  _resetFailureStreak,
} from '../src/playback/engine';
import { subscribeToast } from '../src/lib/toast';

// The cascade cap, driven through the 'network' error class.
//
// playbackCascade.test.js deliberately uses decoder errors: they take no
// backoff, so one event per track reaches give-up. But the field case is
// AIRPLANE MODE, and that is the network class, which walks a different and
// much slower path — attempts 1 and 2 reload the same url on a jittered sleep
// and return, so a track needs three events before it gives up at all. The
// streak lives at the give-up point that every class shares, but nothing
// pinned that the network path actually gets there.
//
// Owner report: "turned on airplane mode and tried skipping a few songs — it
// skipped fifteen to twenty."
//
// Only the SLEEP is stubbed. Classification and the ladder walk stay real, so
// this is the true network path at test speed. Hoisted, so the engine under
// test picks it up on its own first import — re-requiring the engine under
// resetModules would hand it a second copy of the RNTP mock and the assertions
// here would read the untouched original.
jest.mock('../src/lib/retryPolicy', () => ({
  ...jest.requireActual('../src/lib/retryPolicy'),
  retryDelayMs: () => 0,
}));

const NET_ERR = { code: 'android-io-network-connection-failed' };
const CDN = 'https://cdn.example.com';
// No bitrate token ⇒ a single ladder rung, so the walk reaches the refetch on
// its third event rather than grinding down a full quality ladder.
const track = id => ({ id, title: id, url: `${CDN}/${id}.mp4` });

// attempts 1-2 reload and return; attempt 3 exhausts the rung, fails the
// refetch, and gives up.
const EVENTS_PER_GIVE_UP = 3;

let seen = [];
let unsubscribe = null;

beforeEach(() => {
  __resetMock();
  _resetFailureStreak();
  seen = [];
  unsubscribe = subscribeToast(e => seen.push(e.message));
  // Airplane mode: the refetch and the origin probe both reject.
  global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
});

afterEach(() => {
  unsubscribe?.();
  // An offline stop starts a resume wait that polls for minutes with nothing
  // awaiting it. _resetFailureStreak cancels it and clears its live timer —
  // without this the runner stays open long after the assertions have passed.
  _resetFailureStreak();
  delete global.fetch;
});

async function failCurrentTrackToGiveUp() {
  for (let i = 0; i < EVENTS_PER_GIVE_UP; i++) {
    await handlePlaybackError(NET_ERR);
  }
}

test('a run of network failures stops instead of walking the queue', async () => {
  await TrackPlayer.setQueue([1, 2, 3, 4, 5, 6].map(n => track(`n${n}`)));

  for (let t = 0; t < MAX_CONSECUTIVE_SKIPS; t++) {
    await failCurrentTrackToGiveUp();
  }

  const s = __getMockState();
  expect(s.playWhenReady).toBe(false);
  // Two skips then a stop — not the whole queue.
  expect(s.activeIndex).toBe(MAX_CONSECUTIVE_SKIPS - 1);
});

test('the network stop names the connection', async () => {
  await TrackPlayer.setQueue([1, 2, 3, 4, 5].map(n => track(`n${n}`)));

  for (let t = 0; t < MAX_CONSECUTIVE_SKIPS; t++) {
    await failCurrentTrackToGiveUp();
  }

  expect(seen[seen.length - 1]).toMatch(/connection/i);
});
