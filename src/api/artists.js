import { fetchAuthed } from '../lib/auth';
import { apiError } from './apiError';
// Ported from web src/api/artists.js (query string built by hand — RN's
// URL/URLSearchParams are only partially implemented).

// Artist lookup. Resolution order server-side: id (direct) → trackId
// (deterministic — reads the artist off the song detail) → name (search
// tally). Prefer passing trackId whenever a track is at hand.
export async function getArtist({ id, name, trackId } = {}, { signal } = {}) {
  const params = [];
  if (id) {
    params.push(`id=${encodeURIComponent(id)}`);
  }
  if (name) {
    params.push(`name=${encodeURIComponent(name)}`);
  }
  if (trackId) {
    params.push(`trackId=${encodeURIComponent(trackId)}`);
  }
  const res = await fetchAuthed(`/api/artists/lookup?${params.join('&')}`, {
    signal,
  });
  if (!res.ok) {
    throw await apiError(res, 'this artist');
  }
  const data = await res.json();
  return data.artist ?? null;
}
