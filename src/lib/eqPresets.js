import { storage } from '../storage/mmkv';

// User-saved equalizer presets — the curves you dial in and name yourself,
// stored alongside (never replacing) the fixed mood presets in lib/equalizer.
// Ported from the web's src/lib/eqPresets.js: same exports and caps, with
// localStorage swapped for MMKV.
//
// One native difference: the web stores 8 fixed dB values, but here a curve is
// one MILLIBEL value per DEVICE band — and band counts differ between phones.
// So every read is validated against the live band count and a mismatched
// preset is skipped rather than misapplied to the wrong frequencies.

const KEY = 'aura.eq.userPresets';
export const MAX_PRESETS = 20;
export const MAX_NAME = 32;
const subs = new Set();

function makeId() {
  return `p_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function normalize(p) {
  const name = String(p?.name ?? '').trim().slice(0, MAX_NAME);
  if (!name || !Array.isArray(p?.gains)) {
    return null;
  }
  const gains = p.gains.map(n => (Number.isFinite(Number(n)) ? Math.round(Number(n)) : 0));
  return { id: String(p.id ?? makeId()), name, gains };
}

// bandCount: pass the device's band count to get only the presets that fit it.
export function getEqUserPresets(bandCount) {
  try {
    const raw = JSON.parse(storage.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map(normalize)
      .filter(Boolean)
      .filter(p => !bandCount || p.gains.length === bandCount)
      .slice(0, MAX_PRESETS);
  } catch {
    return []; // corrupt store — behave as if there were none
  }
}

function write(list) {
  try {
    storage.setItem(KEY, JSON.stringify(list));
  } catch {
    // storage full/disabled — non-fatal, the live curve is unaffected
  }
  for (const cb of subs) {
    cb(list);
  }
}

// Save the current curve under a name. Returns the new list, or null when the
// name is blank, a case-insensitive duplicate, or the cap is reached — the UI
// checks those up front for specific messaging; this enforces them defensively.
export function saveEqUserPreset(name, gains) {
  const clean = String(name ?? '').trim().slice(0, MAX_NAME);
  if (!clean || !Array.isArray(gains) || !gains.length) {
    return null;
  }
  const list = getEqUserPresets();
  if (list.length >= MAX_PRESETS) {
    return null;
  }
  if (list.some(p => p.name.toLowerCase() === clean.toLowerCase())) {
    return null;
  }
  const next = [...list, { id: makeId(), name: clean, gains: gains.map(Math.round) }];
  write(next);
  return next;
}

export function deleteEqUserPreset(id) {
  const next = getEqUserPresets().filter(p => p.id !== id);
  write(next);
  return next;
}

export function subscribeEqUserPresets(cb) {
  subs.add(cb);
  return () => subs.delete(cb);
}
