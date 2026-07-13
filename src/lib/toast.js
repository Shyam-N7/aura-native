// Tiny pub-sub for ephemeral toasts, ported from web src/lib/toast.js
// (renamed toast -> showToast, subscribe -> subscribeToast per the native
// contract). One toast at a time; firing again replaces the current one.
const subscribers = new Set();
let counter = 0;
// A toast fired before any host mounts is held and replayed to the first
// subscriber — the fire-and-forget bus never silently drops it.
let pending = null;

export function showToast(message) {
  if (!message) {
    return;
  }
  const event = { id: ++counter, message };
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
