// Volume leveling preference + gain math. The per-track loudness number comes
// from the server (api/loudness — measured once per track, shared by every
// listener); this module turns it into a playout gain toward the chosen
// target. v1 is ATTENUATE-ONLY: tracks louder than the target come down to
// it, quieter ones play as mastered — no boost means no clipping and no
// limiter, so the gain is a plain scalar on the player volume. Honest limit:
// leveling evens out the loud masters (most of the catalog), it does not
// lift the quiet ones.
import { storage } from '../storage/mmkv';

const KEY = 'aura.leveling';
const subs = new Set();

// Settings-row order. Targets in LUFS (Spotify's tiers): loud levels less,
// quiet levels hardest.
export const LEVELING_MODES = [
  { id: 'off', target: null, label: 'Off', caption: 'Tracks play as mastered' },
  { id: 'loud', target: -11, label: 'Loud', caption: 'Punchy · levels only the loudest' },
  { id: 'normal', target: -14, label: 'Normal', caption: 'Even volume across tracks' },
  { id: 'quiet', target: -19, label: 'Quiet', caption: 'Gentle · for late nights' },
];
export const DEFAULT_LEVELING = 'normal';

const isValid = id => LEVELING_MODES.some(m => m.id === id);

export function getLeveling() {
  const v = storage.getItem(KEY);
  return isValid(v) ? v : DEFAULT_LEVELING;
}

export function setLeveling(id) {
  if (!isValid(id)) {
    return;
  }
  storage.setItem(KEY, id);
  for (const cb of subs) {
    cb(id);
  }
}

export function subscribeLeveling(cb) {
  subs.add(cb);
  return () => subs.delete(cb);
}

// The playback volume (0..1) for a track's measured loudness under a mode.
// No measurement (or leveling off) → 1: the track plays as mastered.
export function gainFor(modeId, loudness) {
  const mode = LEVELING_MODES.find(m => m.id === modeId);
  if (!mode?.target || typeof loudness?.lufs !== 'number') {
    return 1;
  }
  const gainDb = Math.min(0, mode.target - loudness.lufs);
  return Math.pow(10, gainDb / 20);
}
