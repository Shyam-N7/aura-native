// Event bus for the "add to playlist" bottom sheet, ported from web
// lib/addToPlaylistSheet.js: emits { id, tracks } open events; dismissal is
// local to the sheet. `id` re-keys the picker so per-open state resets.
const subscribers = new Set();
let seq = 0;

export function openAddToPlaylist(trackOrTracks) {
  const tracks = Array.isArray(trackOrTracks)
    ? trackOrTracks
    : [trackOrTracks];
  seq += 1;
  subscribers.forEach(fn => fn({ id: seq, tracks }));
}

export function subscribeAddToPlaylist(fn) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
