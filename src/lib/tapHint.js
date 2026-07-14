import { storage } from '../storage/mmkv';

// Coach-mark bookkeeping, ported from web src/lib/tapHint.js: a hint shows at
// most 3 times and retires forever the moment the user performs the real
// interaction it points at. Counts live in MMKV under 'aura.hint.<id>'
// ('done' = killed). The web's one-live-hint module bus arrives with the
// phases that show more than one hint at a time.
const KEY = id => `aura.hint.${id}`;
const MAX_SHOWS = 3;

export function hintAvailable(id) {
  const v = storage.getItem(KEY(id));
  if (v === 'done') {
    return false;
  }
  return (Number(v) || 0) < MAX_SHOWS;
}

// Call once per appearance so the count advances toward retirement.
export function bumpHint(id) {
  const v = storage.getItem(KEY(id));
  if (v === 'done') {
    return;
  }
  storage.setItem(KEY(id), String((Number(v) || 0) + 1));
}

export function killHint(id) {
  storage.setItem(KEY(id), 'done');
}
