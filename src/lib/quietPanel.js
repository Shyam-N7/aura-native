// Event bus for the quiet panel — same shape as the other sheet buses. The
// home greeting-row bell publishes an open; the single QuietPanelSheet
// instance in App renders it.
const subscribers = new Set();

export function openQuietPanel() {
  subscribers.forEach(fn => fn(true));
}

export function closeQuietPanel() {
  subscribers.forEach(fn => fn(false));
}

export function subscribeQuietPanel(fn) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
