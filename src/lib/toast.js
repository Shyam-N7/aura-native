import { onSessionReset } from './sessionReset';

// Tiny pub-sub for ephemeral toasts, ported from web src/lib/toast.js
// (renamed toast -> showToast, subscribe -> subscribeToast per the native
// contract). One toast at a time; firing again replaces the current one.
const subscribers = new Set();
let counter = 0;
// A toast fired before any host mounts is held and replayed to the first
// subscriber — the fire-and-forget bus never silently drops it.
//
// The buffer exists for the sub-frame gap at startup, and it had no expiry, so
// it also replayed across a whole app lifetime. Playback runs headless
// (background play is on by default), and the engine and the service both
// toast from there: swipe the app away mid-song, hit a stall or a dead track,
// reopen an hour later, and a pill slid up about a network that had long since
// come back. Stamp it and drop anything stale — the gap this covers is
// milliseconds, so a few seconds is generous.
const PENDING_TTL_MS = 5000;
let pending = null;

// opts.tick renders the toast with an animated green check — for successes
// worth celebrating (added to playlist, queue saved), not every message.
export function showToast(message, opts = {}) {
  if (!message) {
    return;
  }
  const event = { id: ++counter, message, tick: !!opts.tick };
  if (subscribers.size === 0) {
    pending = { event, at: Date.now() };
    return;
  }
  for (const cb of subscribers) {
    cb(event);
  }
}

export function subscribeToast(cb) {
  subscribers.add(cb);
  if (pending) {
    const { event, at } = pending;
    // Cleared either way: a message too old to show is also too old to keep
    // for the subscriber after this one.
    pending = null;
    if (Date.now() - at < PENDING_TTL_MS) {
      cb(event);
    }
  }
  return () => {
    subscribers.delete(cb);
  };
}

// A buffered toast belongs to the account that caused it — the sign-out path
// should not hand one to whoever signs in next.
onSessionReset(() => {
  pending = null;
});
