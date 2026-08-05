import { Event, State, __emit, __resetMock } from 'react-native-track-player';

// The service's job is to fan native events out to the handlers PlayerContext
// registers once at boot. Every listener is shaped the same way, so a handler
// that is registered but never called looks completely healthy from the
// PlayerContext side and from any test that mocks the service away.
//
// That is exactly how onPlaybackState stayed dead from the day it was written:
// defined, registered, listed in its effect's deps, and covered by a spec that
// mocks '../src/playback/service' and calls the handler directly — so the one
// thing never exercised was the dispatch itself.
//
// This spec drives the REAL service through the RNTP mock, which is the only
// place that gap is visible.

jest.mock('../src/playback/engine', () => ({
  notePlaybackStarted: jest.fn(),
  handlePlaybackError: jest.fn(),
  play: jest.fn(async () => {}),
  pause: jest.fn(async () => {}),
  seekTo: jest.fn(async () => {}),
  next: jest.fn(async () => {}),
  prev: jest.fn(async () => {}),
  setLikeButton: jest.fn(async () => {}),
}));
jest.mock('../src/lib/toast', () => ({ showToast: jest.fn() }));

let service;
let handlers;

beforeAll(async () => {
  service = require('../src/playback/service');
  // The service self-guards against double wiring, so it is started once for
  // the whole file — the same shape index.js uses.
  await service();
});

beforeEach(() => {
  handlers = {
    onPlaybackState: jest.fn(),
    onQueueEnded: jest.fn(),
    onActiveTrackChanged: jest.fn(),
    onPlayWhenReadyChanged: jest.fn(),
    onProgress: jest.fn(),
  };
  service.registerHandlers(handlers);
});

afterAll(() => {
  __resetMock();
});

test('a playback-state event reaches the registered handler', async () => {
  await __emit(Event.PlaybackState, { state: State.Playing });

  expect(handlers.onPlaybackState).toHaveBeenCalledWith({
    state: State.Playing,
  });
});

// The case the handler exists for: a PlaybackException leaves the native player
// in 'error' while playWhenReady stays true, so nothing else corrects the
// play/pause button. PlaybackError drives recovery; this drives the UI.
test('an error state reaches the handler so the UI can stop claiming to play', async () => {
  await __emit(Event.PlaybackState, { state: State.Error });

  expect(handlers.onPlaybackState).toHaveBeenCalledWith({ state: State.Error });
});

// Delegation must not cost the bookkeeping that shares this listener.
test('the streak reset still runs alongside the dispatch', async () => {
  const engine = require('../src/playback/engine');
  engine.notePlaybackStarted.mockClear();

  await __emit(Event.PlaybackState, { state: State.Playing });

  expect(engine.notePlaybackStarted).toHaveBeenCalled();
  expect(handlers.onPlaybackState).toHaveBeenCalled();
});

// A handler-less service (headless revival before the UI mounts) must not throw
// — the presence guard is what makes the delegation safe there.
test('a missing handler is not an error', async () => {
  service.registerHandlers({ onPlaybackState: undefined });

  await expect(
    __emit(Event.PlaybackState, { state: State.Ready }),
  ).resolves.toBeDefined();
});
