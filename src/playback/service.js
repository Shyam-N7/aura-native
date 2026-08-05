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
const { Image } = require('react-native');
const engine = require('./engine');
const likes = require('../hooks/useLikes');
const { crumb, report } = require('../lib/crumbs');
const { mark } = require('../lib/perfMarks');

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
  // 'remote-like' is an AURA fork event — the notification heart (vendored
  // kotlin-audio custom action + the RNTP patch). RNTP's Event enum doesn't
  // know it, but addEventListener is an unvalidated passthrough. The toggle
  // goes through the likes store — the same optimistic Set + rollback +
  // subscriber fan-out an in-app heart uses, so every mounted heart follows;
  // the icon is re-synced here directly so it also flips with no UI mounted.
  TrackPlayer.addEventListener('remote-like', async () => {
    // The heart's trail, one crumb per hop. "The lock-screen like does
    // nothing" was unlocalisable because every hop failed silently: the event
    // may never arrive, the active track may carry no id, or the write may be
    // refused. Each of those now says so, and the three are distinguishable.
    crumb('playback', 'remote-like');
    const id = (await TrackPlayer.getActiveTrack().catch(() => null))?.id;
    if (!id) {
      // Reached JS but there is nothing to like — a native active track that
      // carries no originalItem (post-kill revival) looks exactly like this.
      crumb('playback', 'remote-like-no-track');
      return;
    }
    const wasLiked = likes.isLikedId(id);
    try {
      if (wasLiked) {
        await likes.unlike(id);
      } else {
        await likes.like(id);
      }
    } catch (err) {
      // The optimistic Set already rolled itself back — the re-sync below
      // simply paints whatever state survived.
      //
      // But it must not roll back SILENTLY. This catch used to swallow
      // everything, which made a failing heart indistinguishable from a
      // working one: the icon returned to its old state, nothing was logged,
      // and "the lock-screen like does nothing" had no evidence anywhere. A
      // tap the user made and the server refused is a terminal failure they
      // feel, so it earns a report.
      report(err, 'player.remote-like-failed', { liked: !wasLiked });
    }
    engine.setLikeButton(likes.isLikedId(id)).catch(() => {});
  });

  // Boot-timing tail (docs/perf/01 §6): when the player first becomes ready /
  // audible. mark() self-dedupes, so only the first of each lands.
  TrackPlayer.addEventListener(Event.PlaybackState, e => {
    if (e?.state === 'ready') {
      mark('first-ready');
    } else if (e?.state === 'playing') {
      mark('first-playing');
    }
  });
  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, e => {
    if (handlers.onQueueEnded) {
      handlers.onQueueEnded(e);
    }
  });
  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, e => {
    // Warm the list-size art (150x150 — TrackRow.artUrl's token) for the new
    // track while the screen may be off: the UI's own image fetch only starts
    // at wake, which left the home banner sitting on the previous cover for
    // seconds (field report). The native artwork is the 500x500 variant.
    const art = e?.track?.artwork;
    if (typeof art === 'string') {
      Image.prefetch(art.replace(/\d+x\d+/, '150x150')).catch(() => {});
    }
    crumb('playback', 'track-change', { id: e?.track?.id, index: e?.index });
    if (handlers.onActiveTrackChanged) {
      handlers.onActiveTrackChanged(e);
    }
  });
  TrackPlayer.addEventListener(Event.PlaybackError, e => {
    crumb('playback', 'error', { code: e?.code, message: e?.message });
    // Both branches are (or may be) the async engine recovery — its awaited
    // load/skip calls can reject mid-recovery; never leave that unhandled.
    const handle = handlers.onPlaybackError ?? engine.handlePlaybackError;
    Promise.resolve(handle(e)).catch(() => {});
  });
  TrackPlayer.addEventListener(Event.PlaybackPlayWhenReadyChanged, e => {
    // Also breadcrumbs a native focus pause/resume — ExoPlayer owns focus
    // (docs/perf/01 §1c), and this event is where its decisions surface.
    crumb('playback', 'play-when-ready', { playWhenReady: e?.playWhenReady });
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
