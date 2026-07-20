import { storage } from '../storage/mmkv';
import { getUser } from './auth';

// Persisted last-known-good snapshots of the app's essential surfaces (home
// sections, the You library summary), so a cold start paints real content
// instantly instead of loaders — the network then refreshes it silently
// underneath (stale-while-revalidate). Each snapshot is stamped with its
// owner; a snapshot written by another account reads as absent, so switching
// users never flashes someone else's library (stale bytes just get
// overwritten by the new owner's first fetch).
const KEY = name => `aura.snapshot.${name}`;
const owner = () => getUser()?.email ?? '';

export function readSnapshot(name) {
  try {
    const raw = storage.getItem(KEY(name));
    if (!raw) {
      return null;
    }
    const { u, d } = JSON.parse(raw);
    return u === owner() && d !== undefined ? d : null;
  } catch {
    return null;
  }
}

export function writeSnapshot(name, d) {
  try {
    storage.setItem(KEY(name), JSON.stringify({ u: owner(), d }));
  } catch {
    // Best-effort — a failed write just means a loader next cold start.
  }
}
