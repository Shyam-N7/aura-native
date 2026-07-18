// In-place gesture hints. Each hint stays on screen until the user actually
// PERFORMS its gesture once — exposure alone never dismisses it (overlay
// tutorials get skipped and forgotten; a hint that lives where the gesture
// happens keeps teaching until the hand learns it). Done-ness is stored, so
// a learned gesture never nags again.
import { storage } from '../storage/mmkv';

const KEY = 'aura.hintsDone';

// The hints that exist, by id.
export const HINT_LIKE = 'double-tap-like';
export const HINT_NEXT = 'swipe-next';
export const HINT_KARAOKE = 'karaoke';
export const HINT_STAGE_TAP = 'karaoke-tap-pause';

const subs = new Set();

function readDone() {
  try {
    const raw = storage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function hintDone(id) {
  return readDone().includes(id);
}

// Called from the gesture handler itself, the moment the gesture lands.
export function markHintDone(id) {
  const done = readDone();
  if (done.includes(id)) {
    return;
  }
  storage.setItem(KEY, JSON.stringify([...done, id]));
  for (const cb of subs) {
    cb(id);
  }
}

export function subscribeHints(cb) {
  subs.add(cb);
  return () => subs.delete(cb);
}
