import TrackPlayer, {
  __getMockState,
  __resetMock,
} from 'react-native-track-player';
import {
  MAX_CONSECUTIVE_SKIPS,
  handlePlaybackError,
  notePlaybackStarted,
  _resetFailureStreak,
} from '../src/playback/engine';
import { subscribeToast } from '../src/lib/toast';

// The cascade this pins: `recovery` is per-track and resets on every track
// change, so the ceiling that stops playback and reports the network can only
// be reached by ONE track accumulating attempts — and no track ever does,
// because it is skipped first. A queue where every track fails (a cold restore
// with no network, every track still holding the PENDING_URL placeholder) was
// therefore walked end to end in silence. Field report after a crash: "it kept
// on skipping all the next songs until I closed the app".

// decoder → 'malformed': no backoff, straight down the ladder — the same lever
// the recovery suite uses to reach give-up in one call. A 'network' error would
// spend its first two attempts reloading the same url on a jittered sleep,
// which is a different path and far slower to drive.
const DECODE_ERR = { code: 'android-decoder-init-failed' };
const CDN = 'https://cdn.example.com';
// No bitrate token ⇒ a single ladder rung, so each error walks straight to the
// refetch and then to give-up. That is the shape a PENDING_URL track has.
const track = id => ({ id, title: id, url: `${CDN}/${id}.mp4` });

let seen = [];
let unsubscribe = null;

beforeEach(() => {
  __resetMock();
  _resetFailureStreak();
  seen = [];
  unsubscribe = subscribeToast(e => seen.push(e.message));
  // Offline: the refetch and the origin probe both reject.
  global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
});

afterEach(() => {
  unsubscribe?.();
  delete global.fetch;
});

// One call = one give-up for this error class and url shape, so each call
// stands for "the current track failed", exactly as RNTP would drive it.
async function failCurrentTrack() {
  await handlePlaybackError(DECODE_ERR);
}

test('a run of failures stops instead of walking the whole queue', async () => {
  await TrackPlayer.setQueue([1, 2, 3, 4, 5, 6].map(n => track(`t${n}`)));

  for (let i = 0; i < MAX_CONSECUTIVE_SKIPS; i++) {
    await failCurrentTrack();
  }

  const s = __getMockState();
  // Two skips, then a stop — NOT six tracks consumed.
  expect(s.activeIndex).toBe(MAX_CONSECUTIVE_SKIPS - 1);
  expect(s.playWhenReady).toBe(false);
});

test('the stop names the connection when the origin is unreachable', async () => {
  await TrackPlayer.setQueue([1, 2, 3, 4].map(n => track(`t${n}`)));

  for (let i = 0; i < MAX_CONSECUTIVE_SKIPS; i++) {
    await failCurrentTrack();
  }

  // The last thing the user is told explains WHY, rather than being the
  // per-skip message overwritten into a flicker.
  expect(seen[seen.length - 1]).toMatch(/connection/i);
});

test('the queue and the playing position are left intact by the stop', async () => {
  const queue = [1, 2, 3, 4, 5].map(n => track(`t${n}`));
  await TrackPlayer.setQueue(queue);

  for (let i = 0; i < MAX_CONSECUTIVE_SKIPS; i++) {
    await failCurrentTrack();
  }

  const s = __getMockState();
  // "the music state shouldn't be lost when data is lost" — only playback
  // pauses; nothing is removed and the active slot still points at a real row.
  expect(s.queue.map(t => t.id)).toEqual(queue.map(t => t.id));
  expect(s.queue[s.activeIndex]).toBeTruthy();
});

test('playback actually starting clears the streak', async () => {
  await TrackPlayer.setQueue([1, 2, 3, 4, 5, 6, 7, 8].map(n => track(`t${n}`)));

  // Two failures — one short of the cap.
  await failCurrentTrack();
  await failCurrentTrack();

  // A track plays: the run is over.
  notePlaybackStarted();

  // A further two failures must skip again rather than trip the cap, which it
  // would if the streak had carried over.
  await failCurrentTrack();
  await failCurrentTrack();

  expect(__getMockState().playWhenReady).toBe(true);
});

test('a single bad track in a healthy session still just skips', async () => {
  await TrackPlayer.setQueue([track('bad'), track('good')]);

  await failCurrentTrack();

  const s = __getMockState();
  expect(s.activeIndex).toBe(1);
  expect(s.playWhenReady).toBe(true);
  expect(seen[seen.length - 1]).toMatch(/skipping/i);
});
