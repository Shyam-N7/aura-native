// Event bus for the "why this song" sheet — same shape as the other sheet
// buses: publishers hand over a track, the single WhySheet instance in App
// renders it.
const subscribers = new Set();

export function openWhy(track) {
  subscribers.forEach(fn => fn(track));
}

export function closeWhy() {
  subscribers.forEach(fn => fn(null));
}

export function subscribeWhy(fn) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
