import { fetchAuthed } from '../lib/auth';
import { apiError } from './apiError';
import { invalidateHomeCache } from '../lib/homeCache';
// Ported from web src/api/likes.js.

export async function listLikedIds({ signal } = {}) {
  const res = await fetchAuthed('/api/likes?ids=1', { signal });
  if (!res.ok) {
    throw await apiError(res, 'your liked songs');
  }
  const { ids } = await res.json();
  return ids ?? [];
}

export async function listLiked({ signal } = {}) {
  const res = await fetchAuthed('/api/likes', { signal });
  if (!res.ok) {
    throw await apiError(res, 'your liked songs');
  }
  const { liked } = await res.json();
  return liked ?? [];
}

export async function likeTrack(trackId) {
  const res = await fetchAuthed('/api/likes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ track_id: trackId }),
  });
  if (!res.ok) {
    throw new Error(`like failed (${res.status})`);
  }
  // Likes boost the quick-picks ranking — refresh it on the next Home visit.
  invalidateHomeCache('quickPicks');
}

export async function unlikeTrack(trackId) {
  const res = await fetchAuthed(`/api/likes/${encodeURIComponent(trackId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`unlike failed (${res.status})`);
  }
  invalidateHomeCache('quickPicks');
}
