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
import { showToast } from '../lib/toast';

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

export async function setupPlayer() {
  if (ready) {
    return;
  }
  try {
    await TrackPlayer.setupPlayer({ autoHandleInterruptions: true });
  } catch (err) {
    // Backgrounded during boot — the caller retries on foreground. Any other
    // failure here means the player is already initialized (fast reload):
    // safe to continue into updateOptions.
    if (err?.code === 'android_cannot_setup_player_in_background') {
      throw err;
    }
  }
  await TrackPlayer.updateOptions({
    android: {
      appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
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
  ready = true;
  // Auto-quality sampler follows the pref from here on (guarded by `ready`,
  // so this subscription happens exactly once).
  ensureAutoSampler();
  subscribeAudioQuality(ensureAutoSampler);
}

// Mirror the model queue into RNTP. When the active RNTP track is already the
// target current track, the queue is rebuilt AROUND it (remove others,
// re-insert history + upcoming) so playback is never interrupted by tail
// mutations (add next / remove / shuffle / auto-radio append). Everything else
// is a full replace + skip; positionSec only applies there (cold restore).
export async function syncQueue(queue, { startIndex, positionSec } = {}) {
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

export function play() {
  return TrackPlayer.play();
}

export function pause() {
  return TrackPlayer.pause();
}

export function next() {
  return TrackPlayer.skipToNext();
}

export function prev() {
  return TrackPlayer.skipToPrevious();
}

export function seekTo(sec) {
  return TrackPlayer.seekTo(sec);
}

export function skipToIndex(i, positionSec) {
  return TrackPlayer.skip(i, positionSec ?? -1);
}

// Swap one queue entry for its hydrated version (fresh streamUrl) without
// touching the rest. Reloads in place when it is the active track.
export async function replaceTrack(index, track) {
  const [rQueue, active] = await Promise.all([
    TrackPlayer.getQueue(),
    TrackPlayer.getActiveTrackIndex(),
  ]);
  if (index < 0 || index >= rQueue.length) {
    return;
  }
  const mapped = toRntpTrack(track);
  if (active === index) {
    const wasPlaying = await TrackPlayer.getPlayWhenReady();
    await TrackPlayer.load(mapped);
    if (wasPlaying) {
      await TrackPlayer.play();
    }
  } else {
    await TrackPlayer.remove([index]);
    await TrackPlayer.add([mapped], index);
  }
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
async function remapQueue(bitrate, { reloadCurrent = true } = {}) {
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

async function loadAndResume(track, position) {
  await TrackPlayer.load(track);
  if (position > 0) {
    await TrackPlayer.seekTo(position);
  }
  await TrackPlayer.play();
}

export async function handlePlaybackError() {
  const [rQueue, active] = await Promise.all([
    TrackPlayer.getQueue(),
    TrackPlayer.getActiveTrackIndex(),
  ]);
  if (active == null || !rQueue[active]) {
    return;
  }
  const cur = rQueue[active];
  if (recovery.id !== cur.id) {
    recovery = { id: cur.id, ladderPos: 0, refetched: false };
  }
  const { position } = await TrackPlayer.getProgress().catch(() => ({
    position: 0,
  }));

  const quality = effectiveBitrate(getAudioQuality());
  const ladder = cur.streamUrl ? qualityLadder(cur.streamUrl, quality) : [];
  recovery.ladderPos += 1;
  if (recovery.ladderPos < ladder.length) {
    await loadAndResume({ ...cur, url: ladder[recovery.ladderPos] }, position);
    return;
  }

  if (!recovery.refetched) {
    recovery.refetched = true;
    const fresh = await fetchTrack(cur.id).catch(() => null);
    if (fresh?.streamUrl && fresh.streamUrl !== cur.streamUrl) {
      recovery.ladderPos = 0;
      const freshLadder = qualityLadder(fresh.streamUrl, quality);
      await loadAndResume(
        { ...cur, streamUrl: fresh.streamUrl, url: freshLadder[0] },
        position,
      );
      return;
    }
  }

  showToast("couldn't play this track — skipping.");
  if (active + 1 < rQueue.length) {
    await TrackPlayer.skipToNext();
    await TrackPlayer.play();
  } else {
    await TrackPlayer.pause();
  }
}
