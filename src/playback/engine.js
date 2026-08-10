import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  RepeatMode,
  State,
} from 'react-native-track-player';
import {
  bitrateFor,
  getAudioQuality,
  qualityLadder,
  subscribeAudioQuality,
} from '../lib/audioQuality';
import { autoTier, noteAutoSample, resetAuto } from '../lib/autoQuality';
import { getTrack as fetchTrack } from '../api/catalog';
import { API_BASE } from '../lib/auth';
import { crumb, report } from '../lib/crumbs';
import { notePlayerReady } from '../lib/equalizer';
import {
  MAX_ATTEMPTS,
  MAX_RECOVERY_MS,
  classifyPlaybackError,
  retryDelayMs,
} from '../lib/retryPolicy';
import { showToast } from '../lib/toast';
import { storage } from '../storage/mmkv';

// The ONLY module that talks to react-native-track-player (one read-only
// exception: hooks/usePlaybackProgress renders RNTP's position ticker).
// PlayerContext owns the model queue { tracks, idx, source } and mirrors it
// into RNTP through syncQueue/skipToIndex; the service delegates headless
// events back to the context.

// Catalog imageUrl carries a WxH size token — request the 500px variant for
// the notification / lockscreen artwork.
const artUrl = u => (u ? u.replace(/\d+x\d+/, '500x500') : undefined);

// A restored queue entry has no streamUrl until it is hydrated (CDN tokens
// rotate, so URLs are never persisted). RNTP requires a url on every track, so
// give pending ones a dead URL — if one is reached before hydration, the
// PlaybackError recovery refetches a fresh URL. Keeping the placeholder in the
// queue preserves model-index ↔ RNTP-index alignment.
const PENDING_URL = 'https://www.aurafm.live/native/pending.mp3';

// The bitrate a quality id means RIGHT NOW: fixed tiers map straight through,
// 'auto' resolves to the adaptive decision (see lib/autoQuality).
function effectiveBitrate(quality) {
  return quality === 'auto' ? autoTier() : bitrateFor(quality);
}

function toRntpTrack(t, quality = getAudioQuality()) {
  const ladder = qualityLadder(t.streamUrl, effectiveBitrate(quality));
  return {
    id: t.id,
    url: ladder[0] ?? PENDING_URL,
    title: t.title,
    artist: t.artist,
    artwork: artUrl(t.imageUrl),
    duration: t.durationSec ?? undefined,
    // Carried on the RNTP track for quality swaps + error-ladder recovery.
    streamUrl: t.streamUrl,
    language: t.language ?? null,
  };
}

let ready = false;
// The notification heart's last-pushed state. updateOptions REPLACES the
// whole option set, so a flip re-sends the full base options.
let likeShown = false;

// Background play — on (the default): closing the app keeps the music and
// the media card alive; off: swiping the app away stops playback and clears
// the card. The service reads the CURRENT options in onTaskRemoved, so a
// runtime flip only needs the same full-options resend the heart uses.
const BG_PLAY_KEY = 'aura.backgroundPlay';
let bgPlay = storage.getItem(BG_PLAY_KEY) !== '0';

const baseOptions = () => ({
  android: {
    appKilledPlaybackBehavior: bgPlay
      ? AppKilledPlaybackBehavior.ContinuePlayback
      : AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
    // AURA's vendored player renders this as a media-session custom action —
    // the lock-screen / media-card heart. Icons are app drawable names.
    likeButton: {
      liked: likeShown,
      likedIcon: 'ic_heart_filled',
      unlikedIcon: 'ic_heart',
    },
  },
  capabilities: [
    Capability.Play,
    Capability.Pause,
    Capability.SkipToNext,
    Capability.SkipToPrevious,
    Capability.SeekTo,
  ],
  compactCapabilities: [
    Capability.Play,
    Capability.Pause,
    Capability.SkipToNext,
  ],
  progressUpdateEventInterval: 1,
});

// Flip the notification heart. Safe pre-setup (the state simply rides along
// when setupPlayer sends the options) and a no-op on repeats, so callers can
// mirror freely.
export async function setLikeButton(liked) {
  if (liked === likeShown) {
    return;
  }
  likeShown = liked;
  if (ready) {
    await TrackPlayer.updateOptions(baseOptions());
  }
}

export function isBackgroundPlay() {
  return bgPlay;
}

// Flip background play (the home-screen toggle). Persisted, and pushed to
// the live service immediately — the next app close honors the new setting.
export async function setBackgroundPlay(on) {
  if (on === bgPlay) {
    return;
  }
  bgPlay = on;
  storage.setItem(BG_PLAY_KEY, on ? '1' : '0');
  if (ready) {
    await TrackPlayer.updateOptions(baseOptions());
  }
}

// Whether the engine intends to play right now — the same signal
// PlaybackPlayWhenReadyChanged mirrors. Lets a fresh JS process adopt the
// live state of a service that kept playing after the last process died.
export function getPlayWhenReady() {
  return TrackPlayer.getPlayWhenReady();
}

export async function setupPlayer() {
  if (ready) {
    return;
  }
  try {
    await TrackPlayer.setupPlayer({
      autoHandleInterruptions: true,
      // docs/perf/02 layers 3-4. 256MB ExoPlayer disk cache (KB units): repeat
      // plays start from disk and mid-track network flaps resume from what's
      // cached (kotlin-audio already sets FLAG_IGNORE_CACHE_ON_ERROR).
      maxCacheSize: 262144,
      // Start audible at 2.5s buffered instead of the default 5s window, and
      // hold a 120s forward window so ExoPlayer finishes the current item
      // early and prebuffers the NEXT one well before the boundary — the
      // other half of the transition-gap fix. Seconds, per RNTP.
      playBuffer: 2.5,
      minBuffer: 30,
      maxBuffer: 120,
    });
  } catch (err) {
    // Backgrounded during boot — the caller retries on foreground. Any other
    // failure here means the player is already initialized (fast reload):
    // safe to continue into updateOptions.
    if (err?.code === 'android_cannot_setup_player_in_background') {
      throw err;
    }
  }
  await TrackPlayer.updateOptions(baseOptions());
  ready = true;
  // An audio session exists from here on. The equalizer is initialised by the
  // app shell, long before this, so on a launch with the EQ already ON its
  // attach asked for a session id the service had not created yet, gave up,
  // and nothing retried — the panel showed the switch on over unprocessed
  // audio for the whole session. This is that retry.
  //
  // Un-awaited on purpose, and swallowing: a device that refuses audio effects
  // must never delay or fail player setup. notePlayerReady no-ops immediately
  // when there is no equalizer module, which is also every test that boots the
  // player.
  notePlayerReady().catch(() => {});
  // Auto-quality sampler follows the pref from here on (guarded by `ready`,
  // so this subscription happens exactly once).
  ensureAutoSampler();
  subscribeAudioQuality(ensureAutoSampler);
}

// One lock for every rewrite of the native queue.
//
// syncQueue and remapQueue run the SAME remove-then-add rebuild against live
// indices. syncQueue rides PlayerContext's op chain; remapQueue does not — the
// auto-quality sampler fires it from a 5s timer that knows nothing about
// React, and 'auto' is the default quality, so that timer is running for
// everyone. Interleaved, each removes against indices the other has already
// invalidated: duplicated or vanished rows in the notification and up-next, or
// a skip to the wrong song. The op chain can't serialize this on its own
// because one of the two writers doesn't go through it, so the lock lives
// here, where both do.
let queueLock = Promise.resolve();
function withQueueLock(run) {
  const pending = queueLock.then(run, run);
  // The chain must survive a failed op — but this caller still sees its error.
  queueLock = pending.then(
    () => {},
    () => {},
  );
  return pending;
}

// Mirror the model queue into RNTP. When the active RNTP track is already the
// target current track, the queue is rebuilt AROUND it (remove others,
// re-insert history + upcoming) so playback is never interrupted by tail
// mutations (add next / remove / shuffle / auto-radio append). Everything else
// is a full replace + skip; positionSec only applies there (cold restore).
export function syncQueue(queue, opts = {}) {
  return withQueueLock(() => syncQueueLocked(queue, opts));
}

async function syncQueueLocked(queue, { startIndex, positionSec } = {}) {
  const tracks = queue?.tracks ?? [];
  if (!tracks.length) {
    await TrackPlayer.reset();
    return;
  }
  const target = tracks.map(t => toRntpTrack(t));
  const idx = Math.max(
    0,
    Math.min(startIndex ?? queue.idx ?? 0, target.length - 1),
  );

  const [rQueue, active] = await Promise.all([
    TrackPlayer.getQueue(),
    TrackPlayer.getActiveTrackIndex(),
  ]);

  const sameList =
    rQueue.length === target.length &&
    rQueue.every((t, i) => t.id === target[i].id);
  if (sameList) {
    if (active !== idx) {
      await TrackPlayer.skip(idx, positionSec ?? -1);
    }
    return;
  }

  const sameCurrent =
    active != null && rQueue[active] && rQueue[active].id === target[idx].id;
  if (sameCurrent) {
    const others = rQueue.map((_, i) => i).filter(i => i !== active);
    if (others.length) {
      await TrackPlayer.remove(others);
    }
    if (idx > 0) {
      await TrackPlayer.add(target.slice(0, idx), 0);
    }
    if (idx + 1 < target.length) {
      await TrackPlayer.add(target.slice(idx + 1));
    }
    return;
  }

  // Full replace kills playWhenReady — restore it so removing the current
  // track (for example) keeps the music going on the track that slides in.
  const wasPlaying = await TrackPlayer.getPlayWhenReady();
  await TrackPlayer.setQueue(target);
  await TrackPlayer.skip(idx, positionSec ?? -1);
  if (wasPlaying) {
    await TrackPlayer.play();
  }
}

// The native player's active index RIGHT NOW — can lead the JS model by one
// event around a gapless boundary (callers use it to resolve that race).
export function getActiveIndex() {
  return TrackPlayer.getActiveTrackIndex();
}

// The active native track itself — pairs with getActiveIndex so the wake
// resync can id-validate an adoption against a mid-rebuild transient.
export function getActiveTrack() {
  return TrackPlayer.getActiveTrack();
}

// How many tracks the NATIVE player holds right now. The play-retry path
// compares this against the JS model: after a system kill the restore can die
// before syncQueue runs, leaving the model full but the native queue EMPTY —
// and play() on an empty native queue no-ops silently (no error to catch).
// A zero here while the model has tracks means: rebuild before playing.
export async function getQueueLength() {
  const q = await TrackPlayer.getQueue();
  return q?.length ?? 0;
}

export function play() {
  return TrackPlayer.play();
}

export function pause() {
  return TrackPlayer.pause();
}

export function next() {
  return TrackPlayer.skipToNext();
}

// Past this many seconds into a track, a "previous" press restarts the current
// song instead of stepping back a track (the universal player convention).
export const RESTART_THRESHOLD_SEC = 3;

export async function getPosition() {
  const { position } = await TrackPlayer.getProgress().catch(() => ({
    position: 0,
  }));
  return position;
}

// Restart-then-skip. PlayerContext's prev is the primary path and carries the
// queue model; this mirrors the decision for the headless fallback — a remote
// 'previous' that arrives before the context has registered onRemotePrev.
export async function prev() {
  if ((await getPosition()) > RESTART_THRESHOLD_SEC) {
    return TrackPlayer.seekTo(0);
  }
  return TrackPlayer.skipToPrevious();
}

export function seekTo(sec) {
  return TrackPlayer.seekTo(sec);
}

// Playback volume 0..1 — volume leveling's per-track gain lands here.
export function setVolume(v) {
  return TrackPlayer.setVolume(v);
}

// -1 is RNTP's "start from the beginning". There used to be a positionSec
// parameter here for skipping into a track mid-way; none of the six call sites
// ever passed one, so it always collapsed to this same default.
export function skipToIndex(i) {
  return TrackPlayer.skip(i, -1);
}

// Swap one queue entry for its hydrated version (fresh streamUrl) without
// touching the rest. Reloads in place when it is the active track.
export async function replaceTrack(index, track) {
  // Rides the queue lock like every other native-queue rewrite. It used to be
  // the one that did not, which left it interleaving with the auto-quality
  // sampler's remapQueue — a 5s timer outside the op chain that runs for
  // everyone, since 'auto' is the default. Each removes against indices the
  // other has already invalidated.
  return withQueueLock(async () => {
    const [rQueue, active] = await Promise.all([
      TrackPlayer.getQueue(),
      TrackPlayer.getActiveTrackIndex(),
    ]);
    if (index < 0 || index >= rQueue.length) {
      return;
    }
    // The slot must still hold the track we were asked to hydrate. Callers
    // resolve `index` against the MODEL before enqueuing, and a bounds check
    // alone cannot tell a valid index from one whose row has since moved —
    // its siblings loadOntoActive and loadAndResume both re-check the id here
    // and this was the outlier.
    if (rQueue[index]?.id !== track.id) {
      return;
    }
    const mapped = toRntpTrack(track);
    if (active === index) {
      const wasPlaying = await TrackPlayer.getPlayWhenReady();
      // load() replaces whatever is current AT CALL TIME, and the await above
      // is long enough for a gapless advance to move it — which would stamp
      // this track's url and metadata onto the song that just started. Confirm
      // the active row is still ours immediately before committing.
      if ((await TrackPlayer.getActiveTrackIndex()) !== index) {
        return;
      }
      await TrackPlayer.load(mapped);
      if (wasPlaying) {
        await TrackPlayer.play();
      }
    } else {
      await TrackPlayer.remove([index]);
      await TrackPlayer.add([mapped], index);
    }
  });
}

// Repeat-one is the one mode RNTP must own natively — a mid-queue track loops
// at its natural end with no JS involved (screen-off safe). 'all' wrap is
// handled at queue end by the context so it can share the tonight's-set path.
export function setNativeRepeat(repeat) {
  return TrackPlayer.setRepeatMode(
    repeat === 'one' ? RepeatMode.Track : RepeatMode.Off,
  );
}

// Re-resolve every queued stream URL for a new bitrate — history too, so a
// prev-press replays at the new tier (web loads every track at the currently
// selected bitrate). The queue is rebuilt around the active track; with
// reloadCurrent, the current track also reloads in place, seeking back to
// where it was — skipped for auto step-UPS, where interrupting a healthy
// stream to re-fetch it fatter would be pure loss.
function remapQueue(bitrate, opts = {}) {
  return withQueueLock(() => remapQueueLocked(bitrate, opts));
}

async function remapQueueLocked(bitrate, { reloadCurrent = true } = {}) {
  const [rQueue, active] = await Promise.all([
    TrackPlayer.getQueue(),
    TrackPlayer.getActiveTrackIndex(),
  ]);
  if (active == null || !rQueue[active]) {
    return;
  }
  const remap = t => {
    const ladder = t.streamUrl ? qualityLadder(t.streamUrl, bitrate) : [];
    return ladder.length ? { ...t, url: ladder[0] } : t;
  };

  const history = rQueue.slice(0, active).map(remap);
  const upcoming = rQueue.slice(active + 1).map(remap);
  const others = rQueue.map((_, i) => i).filter(i => i !== active);
  if (others.length) {
    await TrackPlayer.remove(others);
  }
  if (history.length) {
    await TrackPlayer.add(history, 0);
  }
  if (upcoming.length) {
    await TrackPlayer.add(upcoming);
  }

  if (!reloadCurrent) {
    return;
  }
  const cur = rQueue[active];
  if (altSource.id === cur.id && altSource.url === cur.url) {
    // Music-only is riding THIS slot — a quality remap must not yank the
    // instrumental out from under the karaoke stage. Matching the url too
    // means a stale alt id (a duplicate entry we moved off) can't wrongly
    // freeze a legit full-mix reload.
    return;
  }
  const swapped = remap(cur);
  if (swapped.url !== cur.url) {
    const { position } = await TrackPlayer.getProgress();
    const wasPlaying = await TrackPlayer.getPlayWhenReady();
    await TrackPlayer.load(swapped);
    if (position > 0) {
      await TrackPlayer.seekTo(position);
    }
    if (wasPlaying) {
      await TrackPlayer.play();
    }
  }
}

// User-picked quality change. Leaving 'auto' resets its adaptive state so the
// next auto session starts optimistic instead of inheriting a stale tier.
export async function setQuality(quality) {
  if (quality !== 'auto') {
    resetAuto();
  }
  await remapQueue(effectiveBitrate(quality));
}

// ── karaoke "music only" ─────────────────────────────────────────────────
// The active track can carry a session-only alternate source — the cached
// instrumental. It rides the RNTP track's `url` ONLY (streamUrl stays the
// full mix), so persistence and every rebuild that derives urls from streamUrl
// keep operating on the real stream. altSource pins BOTH the id and the exact
// instrumental url, so the mutated slot is repairable even among duplicate
// queue entries. remapQueue leaves an alt-sourced current track alone; a
// playback error on the instrumental clears it, falls back to the full mix,
// and notifies the UI so the pill can't lie.
let altSource = { id: null, url: null };
let altClearedListener = null;

// The UI observes engine-side clears (instrumental death) so its music-only
// flag and pill follow the audio that's actually playing.
export function setAltClearedListener(fn) {
  altClearedListener = fn;
}

// A deliberate reload of `id` invalidates any in-flight PlaybackError recovery
// walk for it, so the fresh stream starts its ladder from the top rather than
// inheriting a stale rung index.
function resetRecoveryFor(id) {
  if (recovery.id === id) {
    recovery = { id: null, ladderPos: 0, refetched: false };
  }
}

// Full-mix url for a track from its (untouched) streamUrl.
function fullMixUrl(track) {
  const ladder = track.streamUrl
    ? qualityLadder(track.streamUrl, effectiveBitrate(getAudioQuality()))
    : [];
  return ladder[0] ?? track.streamUrl ?? track.url;
}

// Load a url onto the ACTIVE slot with position + play-state carry, but only
// if the active track is still the one we targeted — RNTP's load() replaces
// whatever is current at call time, so a track that advanced during the awaits
// would otherwise get the wrong media stamped onto it.
async function loadOntoActive(expectIdx, expectId, url) {
  const { position } = await TrackPlayer.getProgress();
  const wasPlaying = await TrackPlayer.getPlayWhenReady();
  const [activeNow, queueNow] = await Promise.all([
    TrackPlayer.getActiveTrackIndex(),
    TrackPlayer.getQueue(),
  ]);
  if (activeNow !== expectIdx || queueNow[activeNow]?.id !== expectId) {
    return false; // track advanced under us — abandon, don't corrupt the new slot
  }
  const cur = queueNow[activeNow];
  resetRecoveryFor(expectId);
  await TrackPlayer.load({ ...cur, url });
  if (position > 0) {
    await TrackPlayer.seekTo(position);
  }
  if (wasPlaying) {
    await TrackPlayer.play();
  }
  return true;
}

export async function setMusicOnly(url) {
  if (!url) {
    return revertMusicOnly();
  }
  const [rQueue, active] = await Promise.all([
    TrackPlayer.getQueue(),
    TrackPlayer.getActiveTrackIndex(),
  ]);
  if (active == null || !rQueue[active]) {
    return false;
  }
  const cur = rQueue[active];
  if (url === cur.url) {
    altSource = { id: cur.id, url };
    return true;
  }
  altSource = { id: cur.id, url };
  const ok = await loadOntoActive(active, cur.id, url);
  if (!ok) {
    altSource = { id: null, url: null };
  }
  return ok;
}

// Return to the full mix. Repairs the EXACT slot the instrumental rides (by id
// AND url, so duplicates don't confuse it): the active slot reloads in place
// with position carry; a departed slot (the track already advanced) is patched
// without touching playback. A slot that's gone (removed) needs no repair.
async function revertMusicOnly() {
  const target = altSource;
  altSource = { id: null, url: null };
  if (!target.id) {
    return true;
  }
  const [rQueue, active] = await Promise.all([
    TrackPlayer.getQueue(),
    TrackPlayer.getActiveTrackIndex(),
  ]);
  const idx = rQueue.findIndex(
    t => t?.id === target.id && t?.url === target.url,
  );
  if (idx < 0) {
    return true; // instrumental slot no longer present
  }
  const slot = rQueue[idx];
  const url = fullMixUrl(slot);
  if (!url || url === slot.url) {
    return true;
  }
  // Reload the active slot in place; if the track advanced during the awaits,
  // loadOntoActive bails and we patch the now-departed slot instead — so the
  // instrumental is never left stranded in history for a prev-press to replay.
  const patchedActive =
    idx === active && (await loadOntoActive(active, slot.id, url));
  if (!patchedActive) {
    const at = rQueue.findIndex(
      t => t?.id === target.id && t?.url === target.url,
    );
    const gone = await TrackPlayer.getActiveTrackIndex();
    if (at >= 0 && at !== gone) {
      // A non-active slot: repair without touching playback. No recovery reset
      // here — the departed slot isn't playing, and a same-id ACTIVE duplicate
      // may have a live recovery walk we must not wipe.
      await TrackPlayer.remove([at]);
      await TrackPlayer.add([{ ...slot, url }], at);
    }
  }
  return true;
}

// ── auto-quality sampler ─────────────────────────────────────────────────
// Runs only while the pref is 'auto': every 5s of active playback, feed the
// buffered-ahead seconds to the adaptive policy (lib/autoQuality). On a tier
// change the queued urls re-resolve; only a panic step-DOWN also reloads the
// current track — swapping it to a lighter stream before the stall lands is
// the whole point of the panic.
const AUTO_SAMPLE_MS = 5000;
let autoTimer = null;

async function autoSampleTick() {
  try {
    const { state } = await TrackPlayer.getPlaybackState();
    if (state !== State.Playing) {
      return;
    }
    const { position, buffered } = await TrackPlayer.getProgress();
    const moved = noteAutoSample(Math.max(0, buffered - position));
    if (moved) {
      await remapQueue(autoTier(), { reloadCurrent: moved === 'down' });
    }
  } catch {
    // Player not set up / torn down — the next tick just retries.
  }
}

function ensureAutoSampler() {
  const want = getAudioQuality() === 'auto';
  if (want && !autoTimer) {
    autoTimer = setInterval(autoSampleTick, AUTO_SAMPLE_MS);
    // The sampler must never be what keeps a process alive: under Node
    // (jest) an un-unref'd interval holds the worker open forever. RN
    // timers are plain numbers, where this is a no-op.
    autoTimer.unref?.();
  } else if (!want && autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
}

// ── PlaybackError recovery ───────────────────────────────────────────────
// Walk down the quality ladder for the failing track; ladder exhausted →
// refetch the track ONCE for a fresh CDN URL; still failing → toast and skip
// so a dead track can't stall the session. State is per-track.
// DELIBERATE web deviation: web gives up silently and stays on the dead track
// for the user to skip — fine on a visible tab, but a screen-off phone
// session (the reason this app exists) would just fall silent forever.
let recovery = { id: null, ladderPos: 0, refetched: false };

// Is the slot we started recovering still the one playing? By identity
// (id + url), not index: the waits below are long enough for a queue edit to
// shift the same playing track sideways, and that must not cost it its
// recovery — while a music-only swap or a quality remap of the slot means the
// url under us is no longer ours to overwrite.
async function stillOnSlot(id, url) {
  const [activeNow, queueNow] = await Promise.all([
    TrackPlayer.getActiveTrackIndex(),
    TrackPlayer.getQueue(),
  ]);
  const slot = activeNow == null ? undefined : queueNow[activeNow];
  return slot?.id === id && slot?.url === url;
}

// load() replaces whatever is CURRENT AT CALL TIME, and every rung into here
// has first awaited something slow — the backoff sleep, the offline wait, the
// refetch. Press next during that window and the dead track's url and metadata
// land on the song now playing, which then seeks and plays. So re-check the
// slot first: loadOntoActive's discipline, applied to recovery. The check and
// the load ride the queue lock together so a syncQueue/remapQueue rebuild can't
// land between them; the waits above them stay outside it — holding the lock
// across a 60s offline wait would freeze every queue edit and the sampler.
function loadAndResume(expectId, expectUrl, track, position) {
  return withQueueLock(async () => {
    if (!(await stillOnSlot(expectId, expectUrl))) {
      return false;
    }
    await TrackPlayer.load(track);
    if (position > 0) {
      await TrackPlayer.seekTo(position);
    }
    await TrackPlayer.play();
    return true;
  });
}

// Probe our own origin — any response (even an error status) proves routing;
// only a thrown fetch means offline. 5s cadence per docs/perf/03.
//
// The probe carries its own timeout because RN's fetch has none (OkHttp sets
// no read timeout), so a half-open socket — captive portal, a tunnel, a
// cell/wifi handoff — leaves the promise neither resolved NOR rejected.
const PROBE_TIMEOUT_MS = 5000;
const PROBE_GAP_MS = 5000;

async function probeOrigin(timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(`${API_BASE}/manifest.webmanifest`, {
      method: 'HEAD',
      signal: ctrl.signal,
    });
    return true;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForConnectivity(maxMs) {
  const deadline = Date.now() + maxMs;
  // The clock is tested at the TOP of the loop, not only in the catch. With
  // the old shape a probe that never settled meant the deadline was never
  // reached at all, and the caller (handlePlaybackError) never returned: no
  // pause, no skip, no toast, and isPlaying left true over silence. The wait
  // must be able to give up even when the network refuses to answer.
  while (Date.now() < deadline) {
    try {
      await probeOrigin(Math.min(PROBE_TIMEOUT_MS, deadline - Date.now()));
      return true;
    } catch {
      // offline, or the probe itself timed out — wait, then re-test the clock
    }
    await new Promise(r => setTimeout(r, PROBE_GAP_MS));
  }
  return false;
}

// ── consecutive give-up streak (CROSS-track) ─────────────────────────────
// `recovery` above is per-track, and that is right for the ladder — but it
// means the ceiling that stops playback and reports the network can only be
// reached by ONE track accumulating attempts. A skip resets it. So a queue
// where every track fails — a dead network on a cold restore, where the
// tracks still hold the PENDING_URL placeholder and therefore have an empty
// quality ladder — walks the ENTIRE queue at ~3 attempts each and never trips
// it. Field report: after a crash the app silently skipped every remaining
// song, and the per-skip toast below was invisible because showToast is
// single-slot and each skip overwrote the last.
//
// This counter is what bounds that. It deliberately survives track changes,
// and is cleared only when playback actually starts or the user asks again.
export const MAX_CONSECUTIVE_SKIPS = 3;
// How long to keep watching for the network after stopping. Polled on a
// lazier cadence than the inline wait — this one runs unattended, possibly
// with the screen off, so it must not cost a probe every 5s for minutes.
const RESUME_WAIT_MS = 5 * 60 * 1000;
const RESUME_PROBE_GAP_MS = 15000;

let giveUpStreak = 0;

// ── the failure voice ──────────────────────────────────────────────────────
// Recovery used to be entirely silent for its first ~25 seconds. The ladder
// walks attempts 1-4 with no toast anywhere, and the first thing that speaks
// is the offline pause — which fires only AFTER the ceiling and a full
// 60-second waitForConnectivity, i.e. about 85 seconds after the audio
// actually stopped, as a 1.9-second pill. Field report: "song is pausing when
// no signal, but is not showing any toast when paused or resumed."
//
// A toast on the FIRST error would be the wrong fix. Most network errors are
// blips the ladder recovers from in under a second, silently and correctly,
// and announcing those would be noise. So this is a debounce: say something
// only once a failure has lasted long enough to be worth a user's attention.
//
// Past the first two same-URL reloads (0s and ~1s) and well inside the 20s
// ceiling (MAX_RECOVERY_MS in lib/retryPolicy). This comment said 25s until
// 2026-08-10; the ladder never ran that long.
const TROUBLE_NOTICE_MS = 6000;
let troubleTimer = null;
// Whether we have told the user something is wrong. It also gates the
// acknowledgement when things come back: announcing "back on." to someone who
// was never told anything was off is a non-sequitur.
let troubleAnnounced = false;

function clearTroubleTimer() {
  if (troubleTimer) {
    clearTimeout(troubleTimer);
    troubleTimer = null;
  }
}

// Every terminal message goes through here, so "we have spoken" and "stop the
// pending debounce" can never drift apart.
function announceTrouble(message) {
  clearTroubleTimer();
  troubleAnnounced = true;
  showToast(message);
}

function armTroubleNotice() {
  if (troubleTimer || troubleAnnounced) {
    return;
  }
  troubleTimer = setTimeout(() => {
    troubleTimer = null;
    announceTrouble('connection trouble — trying to get it back.');
  }, TROUBLE_NOTICE_MS);
}

// Bumped to invalidate an in-flight resume wait. The wait is long and nothing
// awaits it, so cancellation is by identity rather than by abort.
let resumeGeneration = 0;
// The live sleep between probes, held so cancelling can CLEAR it. Without
// this the loop keeps a timer alive for the full window even after it has
// been superseded — which pins the process awake (and hangs jest).
let resumeTimer = null;

function cancelResumeWait() {
  resumeGeneration += 1;
  if (resumeTimer) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }
}

/**
 * Playback is healthy again — either it genuinely started, or the user asked
 * for it and has earned a fresh run of attempts. Also abandons any pending
 * resume wait, so a user-initiated play can't be raced by an older one.
 *
 * `userInitiated` is what keeps the acknowledgement honest. Recovery can take
 * up to RESUME_PROBE_GAP_MS after signal returns, with nobody touching the
 * phone, so "back on." is genuinely useful there. Saying it to someone who
 * just pressed play themselves is telling them what they already did — so the
 * two PlayerContext call sites pass the flag and clear the state silently,
 * while the service's `playing` handler does not.
 */
export function notePlaybackStarted({ userInitiated = false } = {}) {
  giveUpStreak = 0;
  cancelResumeWait();
  clearTroubleTimer();
  if (troubleAnnounced) {
    troubleAnnounced = false;
    if (!userInitiated) {
      showToast('back on.');
    }
  }
}

// Test seam: the streak and the resume wait are module state that survives
// between specs, and a leaked wait would hold the runner open.
export function _resetFailureStreak() {
  giveUpStreak = 0;
  cancelResumeWait();
  clearTroubleTimer();
  troubleAnnounced = false;
  // The recovery walk is module state too, and it is keyed by ELAPSED TIME
  // (MAX_RECOVERY_MS). Specs that advance a fake clock leave `startedAt` far
  // in the past, so the next one starts already past the ceiling and takes the
  // give-up branch on its first error — silently, and for reasons that have
  // nothing to do with what it is testing.
  recovery = { id: null, ladderPos: 0, refetched: false };
}

// Watch for the network in the background and pick the SAME track back up.
// This is what "the music state shouldn't be lost when data is lost" means in
// practice: the queue and position were never touched, so resuming is only a
// play() once the origin answers again.
//
// Its own loop rather than waitForConnectivity's: this one runs unattended for
// minutes with nothing awaiting it, so it needs a cancellable sleep and a
// generation check on every pass. The inline ceiling wait has neither and does
// not need them.
function startResumeWait(id, url) {
  const gen = ++resumeGeneration;
  (async () => {
    const deadline = Date.now() + RESUME_WAIT_MS;
    while (Date.now() < deadline && gen === resumeGeneration) {
      let online = false;
      try {
        await probeOrigin(PROBE_TIMEOUT_MS);
        online = true;
      } catch {
        // still down
      }
      if (gen !== resumeGeneration) {
        return;
      }
      if (online) {
        // The user may have moved on while we waited; resuming would yank
        // them back to a song they had left behind.
        if (!(await stillOnSlot(id, url))) {
          return;
        }
        // Let the ladder run again from the top for this track — `refetched`
        // is per-track and still true from the failure, so without this the
        // one rung that can actually fix a stale CDN url would be skipped.
        resetRecoveryFor(id);
        giveUpStreak = 0;
        await TrackPlayer.play().catch(() => {});
        return;
      }
      await new Promise(resolve => {
        resumeTimer = setTimeout(() => {
          resumeTimer = null;
          resolve();
        }, RESUME_PROBE_GAP_MS);
      });
    }
  })();
}

export async function handlePlaybackError(err) {
  const [rQueue, active] = await Promise.all([
    TrackPlayer.getQueue(),
    TrackPlayer.getActiveTrackIndex(),
  ]);
  if (active == null || !rQueue[active]) {
    return;
  }
  const cur = rQueue[active];
  // A dying instrumental falls straight back to the full mix — a broken
  // music-only stream must never take the whole session down with it. Reset
  // the recovery walk (this is a deliberate reload) and tell the UI, so the
  // pill can't keep claiming music-only over audible vocals.
  if (altSource.id === cur.id && altSource.url === cur.url) {
    altSource = { id: null, url: null };
    resetRecoveryFor(cur.id);
    const fallback = fullMixUrl(cur);
    if (fallback && fallback !== cur.url) {
      const { position: at } = await TrackPlayer.getProgress().catch(() => ({
        position: 0,
      }));
      await loadAndResume(cur.id, cur.url, { ...cur, url: fallback }, at);
      altClearedListener?.();
      return;
    }
    altClearedListener?.();
  }
  if (recovery.id !== cur.id) {
    recovery = {
      id: cur.id,
      ladderPos: 0,
      refetched: false,
      attempt: 0,
      startedAt: Date.now(),
    };
  }
  const { position } = await TrackPlayer.getProgress().catch(() => ({
    position: 0,
  }));

  // ── policy layer (docs/perf/03) ─────────────────────────────────────────
  recovery.attempt = (recovery.attempt ?? 0) + 1;
  const klass = classifyPlaybackError(err);
  crumb('recovery', klass, { attempt: recovery.attempt, code: err?.code });
  // Start the clock on the FIRST network error, not on the ceiling. Everything
  // below this point can take a minute and a half to reach a message.
  if (klass === 'network') {
    armTroubleNotice();
  }
  if (
    recovery.attempt > MAX_ATTEMPTS ||
    Date.now() - (recovery.startedAt ?? 0) > MAX_RECOVERY_MS
  ) {
    // Ceiling hit — fall through to the give-up path below, but if the whole
    // DEVICE is offline, skipping would silently chew through the queue and
    // strand the session at its end. Paused-with-position is the honest state;
    // the user's next play (or the connectivity wait) resumes right here.
    if (klass === 'network' && !(await waitForConnectivity(60000))) {
      // Only if this is still the song in front of the user — a minute is
      // plenty of time to press next onto something the disk cache plays fine,
      // and pausing THAT with an offline toast would be a lie.
      if (await stillOnSlot(cur.id, cur.url)) {
        announceTrouble("you're offline — music will wait for you.");
        await TrackPlayer.pause();
        recovery = { id: null, ladderPos: 0, refetched: false };
        // ...and something has to actually be waiting, or that toast is a
        // promise nothing keeps. This branch returns BEFORE the give-up path
        // below, which is where startResumeWait is armed — so a sustained
        // offline stretch on a single track paused with a message about
        // waiting and then watched for nothing. Signal came back and the
        // silence continued until the user pressed play.
        //
        // The sibling case (three tracks failing in a row) did auto-resume,
        // so two offline states the user cannot tell apart behaved
        // differently. Same call, same arguments: it generation-guards
        // itself, re-checks the slot before resuming so it can't yank someone
        // back to a song they left, and notePlaybackStarted cancels it.
        startResumeWait(cur.id, cur.url);
      }
      return;
    }
  } else {
    // Transient network wobbles retry the SAME url on the jittered schedule —
    // laddering down quality for a blip both sounds worse and masks the class.
    if (klass === 'network') {
      const wait = retryDelayMs(recovery.attempt - 1);
      if (wait) {
        await new Promise(r => setTimeout(r, wait));
      }
      if (recovery.attempt <= 2) {
        await loadAndResume(cur.id, cur.url, cur, position);
        return;
      }
    }
    // An expired/forbidden link fails ALL rungs of the same base URL — walking
    // them is seconds of guaranteed 403s. Jump straight to the re-resolve.
    if (klass === 'expired' || klass === 'gone') {
      recovery.ladderPos = Number.MAX_SAFE_INTEGER - 1;
    }
  }

  const quality = effectiveBitrate(getAudioQuality());
  const ladder = cur.streamUrl ? qualityLadder(cur.streamUrl, quality) : [];
  recovery.ladderPos += 1;
  if (recovery.ladderPos < ladder.length) {
    await loadAndResume(
      cur.id,
      cur.url,
      { ...cur, url: ladder[recovery.ladderPos] },
      position,
    );
    return;
  }

  if (!recovery.refetched) {
    recovery.refetched = true;
    // fresh:true — this rung exists BECAUSE the cached URL may be the expired
    // one; serving it back from cache would loop the failure.
    const fresh = await fetchTrack(cur.id, { fresh: true }).catch(() => null);
    if (fresh?.streamUrl && fresh.streamUrl !== cur.streamUrl) {
      recovery.ladderPos = 0;
      const freshLadder = qualityLadder(fresh.streamUrl, quality);
      await loadAndResume(
        cur.id,
        cur.url,
        { ...cur, streamUrl: fresh.streamUrl, url: freshLadder[0] },
        position,
      );
      return;
    }
  }

  // The refetch above is a round trip; if the user moved on during it, this
  // toast-and-skip would punish the song that IS playing.
  if (!(await stillOnSlot(cur.id, cur.url))) {
    return;
  }
  crumb('recovery', 'give-up', { id: cur.id, attempts: recovery.attempt });
  // The ladder is exhausted: every rung, the re-resolve, and the offline wait
  // all failed for a track the user is still sitting on. That is the clearest
  // "playback is broken for this person" signal the app can produce, and until
  // now it left the device as a toast and nothing else.
  report(err, 'playback.give-up', {
    id: cur.id,
    attempts: recovery.attempt,
    klass,
  });

  // Counted only AFTER the stillOnSlot guard above: a give-up the user
  // outran isn't a failure they experienced, and must not push the session
  // toward a stop.
  giveUpStreak += 1;
  if (giveUpStreak >= MAX_CONSECUTIVE_SKIPS) {
    // Enough. Skipping again would keep walking the queue, which is the
    // behaviour being fixed — several songs in a row failing is a broken
    // SESSION, not a broken track, and it deserves an answer instead of
    // silence.
    //
    // The queue and the position are deliberately left alone. Only playback
    // pauses, so whatever the user was listening to is still exactly where
    // they left it.
    await TrackPlayer.pause();
    const online = await probeOrigin(PROBE_TIMEOUT_MS).then(
      () => true,
      () => false,
    );
    if (online) {
      // The origin answers, so this is the catalog or these particular
      // streams — waiting for a network that is already here would be a lie.
      announceTrouble("couldn't play these songs — playback stopped.");
    } else {
      announceTrouble('your connection dropped — waiting for it to come back.');
      startResumeWait(cur.id, cur.url);
    }
    // The streak is NOT cleared here: one more failure after this should stop
    // immediately rather than burn another three tracks. A user play (or
    // playback actually starting) is what earns a fresh run.
    return;
  }

  // Deliberately NOT announceTrouble: this is about one track, not the
  // session. The next track playing fine is the normal outcome, and "back on."
  // after a routine skip would be noise.
  clearTroubleTimer();
  troubleAnnounced = false;
  showToast("couldn't play this track — skipping.");
  if (active + 1 < rQueue.length) {
    await TrackPlayer.skipToNext();
    await TrackPlayer.play();
  } else {
    await TrackPlayer.pause();
  }
}
