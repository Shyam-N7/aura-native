import TrackPlayer from 'react-native-track-player';
import { storage } from '../storage/mmkv';

// The drift gate (reports/07-changelog.md): does RNTP's live queue still match
// the copy MMKV persisted? Same tracks, same order.
//
// It has to run from INSIDE the process. Neither operand is reachable from adb
// on a release build — `dumpsys media_session` reports `queueTitle=null,
// size=0` because RNTP/Media3 publishes playback state and current-item
// metadata to the session but never the queue items, and `run-as` refuses a
// non-debuggable package, which seals MMKV. That gap is why every item in the
// Phase 5 queue shipped with its cheap gate unrun.
//
// __DEV__-only by construction: Metro strips a `if (__DEV__)` branch from the
// release bundle, so shipping users carry none of this — no timer, no bridge
// traffic, no MMKV reads. Debug builds DO emit console to logcat (release
// builds don't), so `adb logcat -s ReactNativeJS` is the readout.

// Compare by id AND position — a reorder that preserves the set is exactly the
// drift this is looking for, so a set-equality check would miss the case that
// matters most.
function diff(nativeIds, storedIds) {
  if (nativeIds.length !== storedIds.length) {
    return `length ${nativeIds.length} vs ${storedIds.length}`;
  }
  for (let i = 0; i < nativeIds.length; i++) {
    if (nativeIds[i] !== storedIds[i]) {
      return `index ${i}: native "${nativeIds[i]}" vs stored "${storedIds[i]}"`;
    }
  }
  return null;
}

export async function dumpQueueDrift(tag = '') {
  if (!__DEV__) {
    return null;
  }
  try {
    // The engine owns every other RNTP call; this reads only, and only in dev.
    const [nativeQueue, activeIndex] = await Promise.all([
      TrackPlayer.getQueue(),
      TrackPlayer.getActiveTrackIndex().catch(() => null),
    ]);
    const nativeIds = (nativeQueue ?? []).map(t => t?.id ?? '<no-id>');

    const raw = storage.getItem('aura.queue');
    const parsed = raw ? JSON.parse(raw) : null;
    const storedIds = (parsed?.tracks ?? []).map(t => t?.id ?? '<no-id>');

    const mismatch = diff(nativeIds, storedIds);
    const idxNote =
      parsed?.idx != null && activeIndex != null && parsed.idx !== activeIndex
        ? ` | ACTIVE INDEX DRIFT native=${activeIndex} stored=${parsed.idx}`
        : '';

    // One line, greppable, states the verdict first so a log sweep can filter
    // on DRIFT without reading the ids.
    console.log(
      `[drift]${tag ? ` ${tag}` : ''} ${mismatch ? `DRIFT ${mismatch}` : 'ok'}` +
        ` | native=${nativeIds.length} stored=${storedIds.length}` +
        ` idx native=${activeIndex} stored=${parsed?.idx}${idxNote}`,
    );
    return { ok: !mismatch && !idxNote, mismatch, nativeIds, storedIds };
  } catch (err) {
    // A broken debug tool must never be mistaken for a broken player.
    console.log(`[drift] check failed: ${err?.message ?? err}`);
    return null;
  }
}
