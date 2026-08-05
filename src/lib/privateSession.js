import { storage } from '../storage/mmkv';
import { onSessionReset } from './sessionReset';

// One-tap private listening: while on, nothing you play feeds
// recommendations, stats, history, or presence — events, impressions, and
// heartbeats are dropped at their API boundaries. Auto-expires after 6 hours
// so a forgotten toggle can't quietly starve the taste profile forever.
const KEY = 'aura.privateUntil';
const SESSION_MS = 6 * 60 * 60 * 1000;
const subs = new Set();

export function privateSessionUntil() {
  const until = Number(storage.getItem(KEY) ?? 0);
  return until > Date.now() ? until : null;
}

export function isPrivateSession() {
  return privateSessionUntil() !== null;
}

export function setPrivateSession(on) {
  if (on) {
    storage.setItem(KEY, String(Date.now() + SESSION_MS));
  } else {
    storage.removeItem(KEY);
  }
  subs.forEach(fn => fn(isPrivateSession()));
}

export function subscribePrivateSession(fn) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

// A private session is one account's decision and must not outlive it. The
// deadline is wall-clock and was never in clearSession's key list, so signing
// out ten minutes into a 6-hour window left the NEXT account silently
// untracked — no events, no impressions, no presence — for the remainder,
// with nothing in their UI to explain it. clearSession drops the key; this
// repaints any mounted toggle.
onSessionReset(() => {
  subs.forEach(fn => fn(isPrivateSession()));
});
