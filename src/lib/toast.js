// Tiny pub-sub for ephemeral toasts, ported from web src/lib/toast.js
// (renamed toast -> showToast, subscribe -> subscribeToast per the native
// contract). One toast at a time; firing again replaces the current one.
const subscribers = new Set();
let counter = 0;
// A toast fired before any host mounts is held and replayed to the first
// subscriber — the fire-and-forget bus never silently drops it.
let pending = null;

// opts.tick renders the toast with an animated green check — for successes
// worth celebrating (added to playlist, queue saved), not every message.
export function showToast(message, opts = {}) {
  if (!message) {
    return;
  }
  const event = { id: ++counter, message, tick: !!opts.tick };
  if (subscribers.size === 0) {
    pending = event;
    return;
  }
  for (const cb of subscribers) {
    cb(event);
  }
}

export function subscribeToast(cb) {
  subscribers.add(cb);
  if (pending) {
    cb(pending);
    pending = null;
  }
  return () => {
    subscribers.delete(cb);
  };
}
