import {
  Event,
  State,
  __emit,
  __resetMock,
  __setPlaybackState,
  __setProgress,
} from 'react-native-track-player';
import { recordEvent } from '../src/api/events';
import { startRecorder } from '../src/playback/recorder';

jest.mock('../src/api/events', () => ({ recordEvent: jest.fn() }));

const T1 = { id: 't1', title: 'one', language: 'tamil', duration: 200 };
const T2 = { id: 't2', title: 'two', language: null, duration: 180 };
const T3 = { id: 't3', title: 'three', language: 'hindi', duration: 240 };

const kinds = () =>
  recordEvent.mock.calls.map(([e]) => `${e.kind}:${e.track_id}`);

let stop;

beforeEach(() => {
  __resetMock();
  recordEvent.mockClear();
  stop = startRecorder(() => 'more like this');
});

afterEach(() => {
  stop();
});

// Arm a track as active (no posts happen while the player is loading).
const activate = (track, last = null, lastPosition = 0) => {
  __setPlaybackState(State.Loading);
  return __emit(Event.PlaybackActiveTrackChanged, {
    index: 0,
    track,
    lastTrack: last ?? undefined,
    lastPosition,
  });
};

const startPlaying = () => {
  __setPlaybackState(State.Playing);
  return __emit(Event.PlaybackState, { state: State.Playing });
};

test("'play' fires once per track, with payload from the contract", async () => {
  await activate(T1);
  __setProgress({ position: 0, duration: 200 });
  await startPlaying();
  await __emit(Event.PlaybackState, { state: State.Playing }); // resume, no dup

  expect(recordEvent).toHaveBeenCalledTimes(1);
  // mood mirrors web's constant design-tweak value; mode falls back to
  // 'everyday' with no signed-in user in storage.
  expect(recordEvent).toHaveBeenCalledWith({
    track_id: 't1',
    kind: 'play',
    position_sec: 0,
    mood: 'calm',
    language: 'tamil',
    mode: 'everyday',
    source: 'more like this',
  });
});

test("'pause' only posts after the track has played", async () => {
  await activate(T1);
  await __emit(Event.PlaybackState, { state: State.Paused });
  expect(recordEvent).not.toHaveBeenCalled();

  await startPlaying();
  __setProgress({ position: 42, duration: 200 });
  await __emit(Event.PlaybackState, { state: State.Paused });

  expect(kinds()).toEqual(['play:t1', 'pause:t1']);
  expect(recordEvent.mock.calls[1][0].position_sec).toBe(42);
});

test("changing away mid-track posts 'skip' (never 'end')", async () => {
  await activate(T1);
  await startPlaying();
  recordEvent.mockClear();

  // Still playing: the incoming track is armed AND gets its 'play'.
  await __emit(Event.PlaybackActiveTrackChanged, {
    index: 1,
    track: T2,
    lastTrack: T1,
    lastPosition: 60,
  });

  expect(kinds()).toEqual(['skip:t1', 'play:t2']);
  // Web posts skip with no position — both clients write null.
  expect(recordEvent.mock.calls[0][0].position_sec).toBeNull();
});

test("a natural end posts the web pause+end pair at duration (never 'skip')", async () => {
  await activate(T1);
  await startPlaying();
  recordEvent.mockClear();

  await __emit(Event.PlaybackActiveTrackChanged, {
    index: 1,
    track: T2,
    lastTrack: T1,
    lastPosition: 199.4,
  });

  expect(kinds()).toEqual(['pause:t1', 'end:t1', 'play:t2']);
  expect(recordEvent.mock.calls[0][0].position_sec).toBe(200);
  expect(recordEvent.mock.calls[1][0].position_sec).toBe(200);
});

test('a track that never played posts nothing when changed away', async () => {
  await activate(T1);
  await activate(T2, T1, 12);
  expect(recordEvent).not.toHaveBeenCalled();
});

test("queue end posts one pause+end pair; the wrap re-arm cannot double-post", async () => {
  await activate(T3);
  await startPlaying();
  recordEvent.mockClear();

  __setPlaybackState(State.Paused);
  await __emit(Event.PlaybackQueueEnded, { track: 0, position: 240 });
  // Context wraps to the same last track before skipping to 0 — same-id
  // event with playedOnce already cleared must stay silent.
  await __emit(Event.PlaybackActiveTrackChanged, {
    index: 0,
    track: T3,
    lastTrack: T3,
    lastPosition: 240,
  });
  await __emit(Event.PlaybackState, { state: State.Paused });

  expect(kinds()).toEqual(['pause:t3', 'end:t3']);
  expect(recordEvent.mock.calls[1][0].position_sec).toBe(240);
});

test('a repeat-one loop posts pause+end+play per pass, every pass', async () => {
  await activate(T1);
  await startPlaying();
  recordEvent.mockClear();

  // Two native RepeatMode.Track loops: the state never leaves Playing, so
  // the same-id track change is the only signal — it must both close the
  // pass AND re-arm + post 'play' for the next one.
  const loop = () =>
    __emit(Event.PlaybackActiveTrackChanged, {
      index: 0,
      track: T1,
      lastTrack: T1,
      lastPosition: 199.8,
    });
  await loop();
  await loop();

  expect(kinds()).toEqual([
    'pause:t1',
    'end:t1',
    'play:t1',
    'pause:t1',
    'end:t1',
    'play:t1',
  ]);
});

test('a same-id queue rebuild mid-track posts nothing', async () => {
  await activate(T1);
  await startPlaying();
  recordEvent.mockClear();

  await __emit(Event.PlaybackActiveTrackChanged, {
    index: 3,
    track: T1,
    lastTrack: T1,
    lastPosition: 45,
  });

  expect(recordEvent).not.toHaveBeenCalled();
});

test('stop() unsubscribes', async () => {
  stop();
  await activate(T1);
  await startPlaying();
  expect(recordEvent).not.toHaveBeenCalled();
  stop = () => {};
});
