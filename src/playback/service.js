// RNTP playback service — runs for as long as the player does, including with
// the screen off or the UI unmounted. Remote transport controls act on the
// engine directly (headless-safe); queue-progression decisions (queue end,
// track change, playback errors, progress persistence) are delegated to the
// handlers the PlayerContext registers, with engine fallbacks so the
// notification keeps working before the UI has mounted.
//
// CommonJS on purpose: index.js registers `require('./src/playback/service')`
// as the service factory, so module.exports must BE the handler function.
const TrackPlayer = require('react-native-track-player').default;
const { Event } = require('react-native-track-player');
const engine = require('./engine');

const handlers = {};

function registerHandlers(next) {
  Object.assign(handlers, next);
}

// The headless task can be invoked again after process reuse — never stack a
// second set of listeners.
let wired = false;

module.exports = async function service() {
  if (wired) {
    return;
  }
  wired = true;

  // A notification tap can race player setup (or land on a cold headless
  // revival) — every engine call here rejects with "player not initialized"
  // in that window, so swallow: there is no UI to surface anything to.
  TrackPlayer.addEventListener(Event.RemotePlay, () =>
    engine.play().catch(() => {}),
  );
  TrackPlayer.addEventListener(Event.RemotePause, () =>
    engine.pause().catch(() => {}),
  );
  TrackPlayer.addEventListener(Event.RemoteSeek, e =>
    engine.seekTo(e.position).catch(() => {}),
  );
  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    if (handlers.onRemoteNext) {
      handlers.onRemoteNext();
    } else {
      engine.next().catch(() => {});
    }
  });
  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    if (handlers.onRemotePrev) {
      handlers.onRemotePrev();
    } else {
      engine.prev().catch(() => {});
    }
  });

  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, e => {
    if (handlers.onQueueEnded) {
      handlers.onQueueEnded(e);
    }
  });
  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, e => {
    if (handlers.onActiveTrackChanged) {
      handlers.onActiveTrackChanged(e);
    }
  });
  TrackPlayer.addEventListener(Event.PlaybackError, e => {
    // Both branches are (or may be) the async engine recovery — its awaited
    // load/skip calls can reject mid-recovery; never leave that unhandled.
    const handle = handlers.onPlaybackError ?? engine.handlePlaybackError;
    Promise.resolve(handle(e)).catch(() => {});
  });
  TrackPlayer.addEventListener(Event.PlaybackPlayWhenReadyChanged, e => {
    if (handlers.onPlayWhenReadyChanged) {
      handlers.onPlayWhenReadyChanged(e);
    }
  });
  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, e => {
    if (handlers.onProgress) {
      handlers.onProgress(e);
    }
  });
};

module.exports.registerHandlers = registerHandlers;
