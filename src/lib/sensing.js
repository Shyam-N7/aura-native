import { storage } from '../storage/mmkv';
// Ported from web src/lib/sensing.js. Device-level cadence for the "sensing"
// welcome intro: on top of the per-user show_sensing preference, show it at
// most once per calendar day (local timezone, rolls at local midnight).
const KEY = 'aura.sensingShown';

function today() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function sensingShownToday() {
  try {
    return storage.getItem(KEY) === today();
  } catch {
    return false;
  }
}

export function markSensingShown() {
  try {
    storage.setItem(KEY, today());
  } catch {
    // storage unavailable — non-fatal
  }
}

// Coarse time-of-day bucket for the greeting copy (web hooks/useNow partOfDay).
export function partOfDay(d = new Date()) {
  const h = d.getHours();
  if (h < 5) {
    return 'night';
  }
  if (h < 12) {
    return 'morning';
  }
  if (h < 17) {
    return 'afternoon';
  }
  if (h < 21) {
    return 'evening';
  }
  return 'night';
}
