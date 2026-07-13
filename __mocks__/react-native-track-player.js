// Manual jest mock for react-native-track-player (auto-applied from the root
// __mocks__ dir — RNTP binds a native module at import). Event-emitter fake
// plus an in-memory queue mirror; tests drive events with __emit and reset
// between cases with __resetMock.

export const Event = {
  PlayerError: 'player-error',
  PlaybackState: 'playback-state',
  PlaybackError: 'playback-error',
  PlaybackQueueEnded: 'playback-queue-ended',
  PlaybackActiveTrackChanged: 'playback-active-track-changed',
  PlaybackPlayWhenReadyChanged: 'playback-play-when-ready-changed',
  PlaybackProgressUpdated: 'playback-progress-updated',
  RemotePlay: 'remote-play',
  RemotePause: 'remote-pause',
  RemoteStop: 'remote-stop',
  RemoteNext: 'remote-next',
  RemotePrevious: 'remote-previous',
  RemoteSeek: 'remote-seek',
  RemoteDuck: 'remote-duck',
};

export const State = {
  None: 'none',
  Ready: 'ready',
  Playing: 'playing',
  Paused: 'paused',
  Stopped: 'stopped',
  Loading: 'loading',
  Buffering: 'buffering',
  Error: 'error',
  Ended: 'ended',
};

export const RepeatMode = { Off: 0, Track: 1, Queue: 2 };

export const Capability = {
  Play: 0,
  PlayFromId: 1,
  PlayFromSearch: 2,
  Pause: 3,
  Stop: 4,
  SeekTo: 5,
  Skip: 6,
  SkipToNext: 7,
  SkipToPrevious: 8,
};

export const AppKilledPlaybackBehavior = {
  ContinuePlayback: 'continue-playback',
  PausePlayback: 'pause-playback',
  StopPlaybackAndRemoveNotification: 'stop-playback-and-remove-notification',
};

const listeners = new Map();
let queue = [];
let activeIndex = null;
let playWhenReady = false;
let repeatMode = RepeatMode.Off;
let progress = { position: 0, duration: 0, buffered: 0 };
let playbackState = { state: State.None };

// Fires every registered listener for `event`; returns a promise so tests can
// await async handlers before asserting.
export function __emit(event, payload) {
  const cbs = [...(listeners.get(event) ?? [])];
  return Promise.all(cbs.map(cb => cb(payload)));
}

export function __setProgress(next) {
  progress = { ...progress, ...next };
}

export function __setPlaybackState(state) {
  playbackState = { state };
}

export function __getMockState() {
  return { queue, activeIndex, playWhenReady, repeatMode };
}

export function __resetMock() {
  listeners.clear();
  queue = [];
  activeIndex = null;
  playWhenReady = false;
  repeatMode = RepeatMode.Off;
  progress = { position: 0, duration: 0, buffered: 0 };
  playbackState = { state: State.None };
}

// RNTP's useProgress hook (consumed by hooks/usePlaybackProgress) — static
// snapshot is enough for tests.
export function useProgress() {
  return { ...progress };
}

const TrackPlayer = {
  setupPlayer: async () => {},
  updateOptions: async () => {},
  registerPlaybackService: () => {},
  addEventListener: (event, cb) => {
    if (!listeners.has(event)) {
      listeners.set(event, new Set());
    }
    listeners.get(event).add(cb);
    return { remove: () => listeners.get(event)?.delete(cb) };
  },
  setQueue: async tracks => {
    queue = [...tracks];
    activeIndex = tracks.length ? 0 : null;
  },
  add: async (tracks, insertBeforeIndex = -1) => {
    const list = Array.isArray(tracks) ? tracks : [tracks];
    if (insertBeforeIndex === -1 || insertBeforeIndex >= queue.length) {
      queue.push(...list);
    } else {
      queue.splice(insertBeforeIndex, 0, ...list);
      if (activeIndex != null && insertBeforeIndex <= activeIndex) {
        activeIndex += list.length;
      }
    }
  },
  remove: async indexes => {
    const idxs = [...(Array.isArray(indexes) ? indexes : [indexes])].sort(
      (a, b) => b - a,
    );
    for (const i of idxs) {
      queue.splice(i, 1);
      if (activeIndex != null && i < activeIndex) {
        activeIndex -= 1;
      }
    }
  },
  removeUpcomingTracks: async () => {
    if (activeIndex != null) {
      queue = queue.slice(0, activeIndex + 1);
    }
  },
  load: async track => {
    if (activeIndex == null) {
      queue = [track];
      activeIndex = 0;
    } else {
      queue[activeIndex] = track;
    }
  },
  skip: async index => {
    activeIndex = index;
  },
  skipToNext: async () => {
    if (activeIndex != null && activeIndex + 1 < queue.length) {
      activeIndex += 1;
    }
  },
  skipToPrevious: async () => {
    if (activeIndex != null && activeIndex > 0) {
      activeIndex -= 1;
    }
  },
  play: async () => {
    playWhenReady = true;
  },
  pause: async () => {
    playWhenReady = false;
  },
  seekTo: async () => {},
  setRepeatMode: async mode => {
    repeatMode = mode;
  },
  reset: async () => {
    queue = [];
    activeIndex = null;
    playWhenReady = false;
  },
  getQueue: async () => [...queue],
  getActiveTrackIndex: async () =>
    activeIndex == null ? undefined : activeIndex,
  getActiveTrack: async () =>
    activeIndex == null ? undefined : queue[activeIndex],
  getProgress: async () => ({ ...progress }),
  getPlaybackState: async () => ({ ...playbackState }),
  getPlayWhenReady: async () => playWhenReady,
};

export default TrackPlayer;
