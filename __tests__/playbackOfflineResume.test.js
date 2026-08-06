import TrackPlayer, {
  __getMockState,
  __resetMock,
} from 'react-native-track-player';
import { handlePlaybackError, _resetFailureStreak } from '../src/playback/engine';
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
const track = { id: 'n1', title: 'n1', url: 'https://cdn.example.com/n1.mp4' };

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
