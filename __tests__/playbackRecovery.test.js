import TrackPlayer, {
  __getMockState,
  __resetMock,
} from 'react-native-track-player';
import { handlePlaybackError } from '../src/playback/engine';
import { subscribeToast } from '../src/lib/toast';

// PlaybackError recovery rides the RNTP event, not PlayerContext's op chain,
// and every rung waits before it acts: the jittered backoff, the offline
// probe, the fresh-URL refetch. TrackPlayer.load() replaces whatever is
// CURRENT AT CALL TIME, so pressing next during one of those waits used to
// stamp the dead track's url and metadata onto the song that had just started
// — and the give-up path then toasted and skipped that song too.

const NET_ERR = { code: 'android-io-network-connection-failed' };
// decoder → 'malformed': no backoff, straight down the ladder.
const DECODE_ERR = { code: 'android-decoder-init-failed' };

const CDN = 'https://cdn.example.com';
const track = (id, url) => ({ id, title: id, url, streamUrl: url });

beforeEach(() => {
  __resetMock();
  global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
});

afterEach(() => {
  delete global.fetch;
});

const flush = () => new Promise(r => setTimeout(r, 0));

test('a next-press during the retry backoff cannot land on the new song', async () => {
  const two = track('n2', `${CDN}/two_320.mp4`);
  await TrackPlayer.setQueue([track('n1', `${CDN}/one_320.mp4`), two]);

  // The schedule starts at 0, so attempt 1 reloads n1 at once; attempt 2 is
  // the one that sleeps ~1s, and that sleep is the window.
  await handlePlaybackError(NET_ERR);
  const retry = handlePlaybackError(NET_ERR);
  await TrackPlayer.skipToNext();
  await retry;

  const s = __getMockState();
  expect(s.activeIndex).toBe(1);
  expect(s.queue[1]).toEqual(two);
});

test('the ladder rung still lands while the track is the one playing', async () => {
  await TrackPlayer.setQueue([track('n3', `${CDN}/three_320.mp4`)]);

  await handlePlaybackError(DECODE_ERR);

  const s = __getMockState();
  expect(s.queue[0].url).toBe(`${CDN}/three_160.mp4`);
  expect(s.playWhenReady).toBe(true);
});

test('a next-press during the refetch keeps the give-up skip off the new song', async () => {
  // A tokenless url has exactly one rung, so the walk goes straight to the
  // refetch — its round trip is the window.
  let failFetch;
  global.fetch = jest.fn(
    () =>
      new Promise((_, reject) => {
        failFetch = reject;
      }),
  );
  const seen = [];
  const unsubscribe = subscribeToast(e => seen.push(e.message));

  await TrackPlayer.setQueue([
    track('n4', `${CDN}/four.mp4`),
    track('n5', `${CDN}/five.mp4`),
    track('n6', `${CDN}/six.mp4`),
  ]);

  const walk = handlePlaybackError(DECODE_ERR);
  await flush();
  await TrackPlayer.skipToNext();
  failFetch(new Error('offline'));
  await walk;
  unsubscribe();

  const s = __getMockState();
  expect(s.activeIndex).toBe(1); // n5 kept, not skipped past
  expect(seen).toEqual([]);
});
