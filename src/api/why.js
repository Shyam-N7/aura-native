import { fetchAuthed } from '../lib/auth';
// Ported from web src/api/why.js. Curator's reasoning for a track:
// { headline, body, dimensions: [{label,value,strength}], considered, confidence }.
export async function getWhy({ trackId, mood, recentTrackIds = [], signal } = {}) {
  const res = await fetchAuthed('/api/why', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      track_id: trackId,
      mood,
      recent_track_ids: recentTrackIds,
    }),
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `why fetch failed (${res.status})`);
  }
  return res.json();
}
