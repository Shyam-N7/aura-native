import { fetchAuthed } from '../lib/auth';
// Ported from web src/api/playlists.js — Phase 2 needs the list plus the
// add-to-playlist flow (create + add track); detail/sharing arrive with
// Phase 3.

export async function listPlaylists({ signal } = {}) {
  const res = await fetchAuthed('/api/playlists', { signal });
  if (!res.ok) {
    throw new Error(`playlists fetch failed (${res.status})`);
  }
  const { playlists } = await res.json();
  return playlists ?? [];
}

export async function createPlaylist({ name, description = null } = {}) {
  const res = await fetchAuthed('/api/playlists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `create failed (${res.status})`);
  }
  return res.json();
}

// 409 carries code 'duplicate' so bulk adds can skip already-added tracks
// without failing the whole run.
export async function addToPlaylist(playlistId, trackId) {
  const res = await fetchAuthed(
    `/api/playlists/${encodeURIComponent(playlistId)}/tracks`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ track_id: trackId }),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `add failed (${res.status})`);
    err.status = res.status;
    if (res.status === 409) {
      err.code = 'duplicate';
    }
    throw err;
  }
}
