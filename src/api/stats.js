import { fetchAuthed } from '../lib/auth';
// Ported from web src/api/stats.js.

export async function getMostPlayed({ days = 30, limit = 10, signal } = {}) {
  const res = await fetchAuthed(
    `/api/stats/most-played?days=${days}&limit=${limit}`,
    { signal },
  );
  if (!res.ok) {
    throw new Error(`most-played failed (${res.status})`);
  }
  const { tracks } = await res.json();
  return tracks ?? [];
}

export async function getTopArtists({ days = 30, limit = 8, signal } = {}) {
  const res = await fetchAuthed(
    `/api/stats/top-artists?days=${days}&limit=${limit}`,
    { signal },
  );
  if (!res.ok) {
    throw new Error(`top-artists failed (${res.status})`);
  }
  const { artists } = await res.json();
  return artists ?? [];
}

export async function getRecentlyPlayed({ limit = 10, signal } = {}) {
  const res = await fetchAuthed(`/api/stats/recently-played?limit=${limit}`, {
    signal,
  });
  if (!res.ok) {
    throw new Error(`recently-played failed (${res.status})`);
  }
  const { tracks } = await res.json();
  return tracks ?? [];
}

// Paginated play log. Pass `before` (a ts) to load older plays. Returns
// { plays: [{...track, playedAt}], nextBefore }.
export async function getHistory({ limit = 80, before, signal } = {}) {
  const cursor = before ? `&before=${before}` : '';
  const res = await fetchAuthed(`/api/history?limit=${limit}${cursor}`, {
    signal,
  });
  if (!res.ok) {
    throw new Error(`history failed (${res.status})`);
  }
  return res.json();
}

// Windowed plays for the music clock — the client buckets them by local hour.
export async function getMusicClockPlays({ days = 60, signal } = {}) {
  const res = await fetchAuthed(`/api/history/clock?days=${days}`, { signal });
  if (!res.ok) {
    throw new Error(`music-clock failed (${res.status})`);
  }
  const { plays } = await res.json();
  return plays ?? [];
}
