// Event bus for the track-actions bottom sheet (the native TrackContextMenu):
// any row publishes { track, menu:{ omit, extras } }; the single sheet
// instance in App renders it. Ported bus model from web lib/trackContextMenu
// — the DOM popup/coords machinery is replaced by the sheet itself.
const subscribers = new Set();

export function openTrackActions({ track, menu = {} }) {
  const event = {
    track,
    omit: menu.omit ?? [],
    extras: menu.extras ?? [],
  };
  subscribers.forEach(fn => fn(event));
}

export function closeTrackActions() {
  subscribers.forEach(fn => fn(null));
}

export function subscribeTrackActions(fn) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
