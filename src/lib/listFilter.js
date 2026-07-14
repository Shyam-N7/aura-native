import { cleanTitle } from '../utils/title';

// In-list search + sort for track collections (liked, playlist details).
// Matching is a plain case-insensitive substring over title + artist — these
// lists live fully in memory, so there is no query language to invent.
export function filterTracks(tracks, query) {
  const q = query.trim().toLowerCase();
  if (!q) {
    return tracks;
  }
  return tracks.filter(
    t =>
      cleanTitle(t.title ?? '')
        .toLowerCase()
        .includes(q) || (t.artist ?? '').toLowerCase().includes(q),
  );
}

// 'default' keeps the incoming order (server recency for liked, curated
// order for playlists) — each surface names that chip itself.
export function sortTracks(tracks, sortId) {
  const arr = [...tracks];
  switch (sortId) {
    case 'title':
      return arr.sort((a, b) =>
        cleanTitle(a.title ?? '').localeCompare(cleanTitle(b.title ?? '')),
      );
    case 'artist':
      return arr.sort((a, b) => (a.artist ?? '').localeCompare(b.artist ?? ''));
    case 'longest':
      return arr.sort((a, b) => (b.durationSec ?? 0) - (a.durationSec ?? 0));
    default:
      return tracks;
  }
}

// Split `text` around the first case-insensitive `query` hit so the matched
// run can be tinted in place.
export function splitMatch(text, query) {
  const q = query.trim().toLowerCase();
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at < 0) {
    return [{ text, hit: false }];
  }
  return [
    { text: text.slice(0, at), hit: false },
    { text: text.slice(at, at + q.length), hit: true },
    { text: text.slice(at + q.length), hit: false },
  ].filter(p => p.text);
}
