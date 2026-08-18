// Event bus for the listening-mode picker sheet — same shape as the other
// sheet buses. The TopBar pill publishes an open; the single ModeSheet
// instance in App renders it.
const subscribers = new Set();

export function openModeSheet() {
  subscribers.forEach(fn => fn(true));
}

export function closeModeSheet() {
  subscribers.forEach(fn => fn(false));
}

export function subscribeModeSheet(fn) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

// One-line hints per mode key (the server sends labels, not descriptions).
export const MODE_HINT = {
  everyday: 'Your usual mix',
  family: 'Clean, all-ages',
  kids: 'Made for little ones',
  bhakti: 'Devotional',
  trip: 'On the road',
  focus: 'Calm, low-distraction',
  car: 'Drive-safe',
};
