// "what's new" — a one-time guide to freshly shipped features. The sheet
// opens by itself the first time an updated app reaches the main flow, then
// never again for the same batch (bump WHATS_NEW_BATCH when a new set of
// features ships). Always reachable later from you → settings.
import { storage } from '../storage/mmkv';

const KEY = 'aura.whatsNewSeen';
// One id per shipped feature batch — a new id re-arms the auto-open.
export const WHATS_NEW_BATCH = '2026-07-gestures-sound';

const subs = new Set();

export function openWhatsNew() {
  for (const cb of subs) {
    cb(true);
  }
}

export function closeWhatsNew() {
  // Seen is recorded on CLOSE, so an app killed mid-sheet shows it again.
  storage.setItem(KEY, WHATS_NEW_BATCH);
  for (const cb of subs) {
    cb(false);
  }
}

export function subscribeWhatsNew(cb) {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function shouldShowWhatsNew() {
  return storage.getItem(KEY) !== WHATS_NEW_BATCH;
}
