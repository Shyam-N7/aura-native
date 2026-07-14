import { fetchAuthed } from '../lib/auth';

// Hidden songs — "don't show this again." Hiding stops AURA picking the track
// for mixes and auto-radio; it never touches likes, playlists or history, and
// the list is visible and undoable in Settings. Ported from web
// src/api/hidden.js.
export async function listHidden({ signal } = {}) {
  const res = await fetchAuthed('/api/hidden', { signal });
  if (!res.ok) {
    throw new Error(`hidden fetch failed (${res.status})`);
  }
  const { hidden } = await res.json();
  return hidden ?? [];
}

export async function hideTrack(trackId) {
  const res = await fetchAuthed('/api/hidden', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ track_id: trackId }),
  });
  if (!res.ok) {
    throw new Error(`hide failed (${res.status})`);
  }
}

export async function unhideTrack(trackId) {
  const res = await fetchAuthed(`/api/hidden/${encodeURIComponent(trackId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`unhide failed (${res.status})`);
  }
}
