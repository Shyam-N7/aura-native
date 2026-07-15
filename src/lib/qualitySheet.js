// Event bus for the audio-quality picker sheet — same shape as the other sheet
// buses. The player's quality pill publishes an open; the single QualitySheet
// instance in App renders it.
const subscribers = new Set();

export function openQualitySheet() {
  subscribers.forEach(fn => fn(true));
}

export function closeQualitySheet() {
  subscribers.forEach(fn => fn(false));
}

export function subscribeQualitySheet(fn) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
