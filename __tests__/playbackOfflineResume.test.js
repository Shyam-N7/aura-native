import TrackPlayer, {
  __getMockState,
  __resetMock,
} from 'react-native-track-player';
import {
  handlePlaybackError,
  notePlaybackStarted,
  _resetFailureStreak,
} from '../src/playback/engine';
import { subscribeToast } from '../src/lib/toast';

// The mid-song offline pause used to promise something nothing delivered.
//
// When recovery hits its ceiling on a network error and the whole device is
// offline, the engine toasts "you're offline — music will wait for you", pauses
// and RETURNS — before the give-up path below it, which is the only place
// startResumeWait was armed. So nothing watched for the network. In a tunnel
// with the screen off, signal coming back changed nothing: silence until the
// user noticed and pressed play. The sibling case (three tracks failing in a
// row) DID auto-resume, so two offline states a user cannot tell apart behaved
// differently.
//
// Own file, because these use fake timers and the sibling cascade spec depends
// on real ones. Hoisted mock for the same reason as that spec: re-requiring
// the engine under resetModules hands it a second copy of the RNTP mock.
jest.mock('../src/lib/retryPolicy', () => ({
  ...jest.requireActual('../src/lib/retryPolicy'),
  retryDelayMs: () => 0,
}));

const NET_ERR = { code: 'android-io-network-connection-failed' };
const mk = id => ({ id, title: id, url: `https://cdn.example.com/${id}.mp4` });
const track = mk('n1');

// MAX_RECOVERY_MS is 20s. Crossing it is the cheapest way to the ceiling: the
// attempt-count route needs seven events on one track, and the give-up streak
// would arm a resume wait on its own before then — which is the OTHER path and
// would mask what this is testing.
const PAST_RECOVERY_CEILING_MS = 25_000;
const CONNECTIVITY_WAIT_MS = 61_000;
const PAST_RESUME_PROBE_GAP_MS = 16_000;

let seen = [];
let unsubscribe = null;

beforeEach(async () => {
  jest.useFakeTimers();
  __resetMock();
  _resetFailureStreak();
  seen = [];
  // Drain any toast buffered by an earlier spec — the bus replays one event to
  // the next subscriber.
  subscribeToast(() => {})();
  unsubscribe = subscribeToast(e => seen.push(e.message));
  goOffline();
  // One track, so the give-up path pauses rather than skipping and the same
  // track stays active across events.
  await TrackPlayer.setQueue([track]);
});

afterEach(() => {
  unsubscribe?.();
  _resetFailureStreak(); // cancels a live resume wait and its timer
  jest.useRealTimers();
  delete global.fetch;
});

const goOffline = () => {
  global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
};
const goOnline = () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
};

// handlePlaybackError awaits real sleeps inside; drive the fake clock while it
// is pending rather than after it.
async function failWhileAdvancing(ms) {
  const pending = handlePlaybackError(NET_ERR);
  await jest.advanceTimersByTimeAsync(ms);
  await pending;
}

async function pauseOfflineMidSong() {
  await failWhileAdvancing(0); // attempt 1: reloads and returns
  await jest.advanceTimersByTimeAsync(PAST_RECOVERY_CEILING_MS);
  await failWhileAdvancing(CONNECTIVITY_WAIT_MS); // attempt 2: ceiling, offline
}

test('going offline mid-song pauses and says it will wait', async () => {
  await pauseOfflineMidSong();

  expect(__getMockState().playWhenReady).toBe(false);
  expect(seen[seen.length - 1]).toMatch(/offline/i);
  // The queue and the position are deliberately untouched — resuming is only a
  // play() once the origin answers.
  expect(__getMockState().activeIndex).toBe(0);
});

test('the music actually resumes when the connection comes back', async () => {
  await pauseOfflineMidSong();
  expect(__getMockState().playWhenReady).toBe(false);

  // Signal returns while the app is backgrounded and nobody presses anything.
  goOnline();
  await jest.advanceTimersByTimeAsync(PAST_RESUME_PROBE_GAP_MS);

  // Before the fix this stayed false forever: the toast promised a wait that
  // nothing was keeping.
  expect(__getMockState().playWhenReady).toBe(true);
});

test('a wait that is superseded does not resume behind the user', async () => {
  await pauseOfflineMidSong();

  // The user gets bored and starts something themselves. notePlaybackStarted
  // cancels the wait, so the network coming back must not yank playback a
  // second time or fight whatever they chose.
  _resetFailureStreak();
  await TrackPlayer.pause();

  goOnline();
  await jest.advanceTimersByTimeAsync(PAST_RESUME_PROBE_GAP_MS * 3);

  expect(__getMockState().playWhenReady).toBe(false);
});

// ── the interaction cases ──────────────────────────────────────────────────
// An unattended loop that calls play() minutes later is the kind of thing that
// is right in isolation and wrong in company. These pin the three ways it
// could misbehave around the user.

test('the wait does not yank you back off a song you moved to', async () => {
  await TrackPlayer.setQueue([mk('n1'), mk('n2')]);
  await pauseOfflineMidSong();

  // Offline, but the next track is already in ExoPlayer's disk cache, so the
  // user skips onto it and plays.
  await TrackPlayer.skipToNext();
  await TrackPlayer.play();
  expect(__getMockState().activeIndex).toBe(1);

  goOnline();
  await jest.advanceTimersByTimeAsync(PAST_RESUME_PROBE_GAP_MS * 2);

  // stillOnSlot is what stops the wait dragging them back to n1.
  expect(__getMockState().activeIndex).toBe(1);
});

test('pressing play cancels the wait, so it cannot fire again later', async () => {
  await pauseOfflineMidSong();

  // What PlayerContext does on a deliberate play press, and what the service
  // does the moment audio is genuinely coming out.
  notePlaybackStarted();
  await TrackPlayer.pause(); // ...and the user pauses again straight after

  goOnline();
  await jest.advanceTimersByTimeAsync(PAST_RESUME_PROBE_GAP_MS * 3);

  expect(__getMockState().playWhenReady).toBe(false);
});

test('a second arming supersedes the first — one resume, not two', async () => {
  // Arming from two places is what this change introduces, so the guard that
  // makes that safe is worth pinning. Two full trips through the offline
  // ceiling arm two waits; the generation counter has to retire the first.
  await pauseOfflineMidSong();
  await pauseOfflineMidSong();

  // Count only what happens once the network returns. A global play() count
  // cannot see this: the offline branch resets `recovery`, so the next error
  // restarts the retry ladder, and loadAndResume calls play() on its own.
  const play = jest.spyOn(TrackPlayer, 'play');
  goOnline();
  await jest.advanceTimersByTimeAsync(PAST_RESUME_PROBE_GAP_MS * 4);

  expect(play).toHaveBeenCalledTimes(1);
  play.mockRestore();
});

test('the wait gives up after its window instead of polling forever', async () => {
  await pauseOfflineMidSong();

  // Five minutes of nothing, then the network returns. The wait is over — the
  // queue and position are still intact, so the user's next play resumes.
  await jest.advanceTimersByTimeAsync(6 * 60 * 1000);
  goOnline();
  await jest.advanceTimersByTimeAsync(PAST_RESUME_PROBE_GAP_MS * 2);

  expect(__getMockState().playWhenReady).toBe(false);
  expect(__getMockState().activeIndex).toBe(0);
});
