import { useRef } from 'react';
import { useProgress } from 'react-native-track-player';
import { storage } from '../storage/mmkv';

// The cold-open restore is network-gated (docs/perf/01 §2): until a catalog
// round-trip returns fresh stream URLs, the native player has no queue and
// useProgress reports 0:00 — which read as "my position wasn't saved". The
// snapshot in MMKV knows better, so it seeds the display until the engine
// reports real data for the first time. Same window/track guards as
// storedPositionSec (PlayerContext), read from the same two keys.
function readSeed() {
  try {
    const pos = JSON.parse(storage.getItem('aura.position') ?? 'null');
    const q = JSON.parse(storage.getItem('aura.queue') ?? 'null');
    const t = q?.tracks?.[q.idx];
    if (
      pos &&
      t &&
      pos.trackId === t.id &&
      t.durationSec > 0 &&
      pos.progress > 0.01 &&
      pos.progress < 0.98
    ) {
      return {
        position: pos.progress * t.durationSec,
        duration: t.durationSec,
      };
    }
  } catch {
    // corrupt snapshot — fall through to live-only
  }
  return null;
}

// The one read-only exception to "only engine.js talks to RNTP": the position
// ticker. Default 4Hz for the scrubber; slower consumers (presence heartbeats)
// pass their own interval.
export function usePlaybackProgress(intervalMs = 250) {
  // `buffered` is how far ahead ExoPlayer has actually loaded. Playback is
  // progressive (playBuffer 2.5 / minBuffer 30 / maxBuffer 120 in
  // engine.setupPlayer), so this trails the end of the track for most of a
  // stream and collapses toward the playhead on a weak connection — which is
  // exactly the thing the player had no way of showing. RNTP populates it on
  // Android; engine.js already reads it to drive auto-quality.
  const { position, duration, buffered } = useProgress(intervalMs);
  // Once the engine has spoken ONCE, the seed is dead for good — it must
  // never shadow a real 0:00 (a fresh pick genuinely starts at zero).
  const engineSeen = useRef(false);
  const seed = useRef(undefined);
  if (duration > 0) {
    engineSeen.current = true;
  }
  if (!engineSeen.current && seed.current === undefined) {
    seed.current = readSeed();
  }
  if (!engineSeen.current && seed.current) {
    return {
      position: seed.current.position,
      duration: seed.current.duration,
      progress: Math.min(1, seed.current.position / seed.current.duration),
      // Nothing is loaded yet in this window — the native player has no queue.
      // Reporting 0 is honest; the seed only knows where the user left off.
      buffered: 0,
      bufferedProgress: 0,
    };
  }
  return {
    position,
    duration,
    progress: duration > 0 ? Math.min(1, position / duration) : 0,
    buffered,
    // Clamped below at `progress`: a buffered head that reads BEHIND the
    // playhead (it can, for a beat after a seek) would draw as a bar running
    // backwards out of the thumb.
    bufferedProgress:
      duration > 0
        ? Math.min(1, Math.max(buffered / duration, position / duration))
        : 0,
  };
}
