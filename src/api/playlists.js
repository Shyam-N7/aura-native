import { API_BASE, fetchAuthed } from '../lib/auth';
import { apiError } from './apiError';
// Ported verbatim from web src/api/playlists.js (Phase 3 completes the file:
// detail, collaboration, visibility, covers, save-to-library, public reads).

export async function listPlaylists({ signal } = {}) {
  const res = await fetchAuthed('/api/playlists', { signal });
  if (!res.ok) {
    throw await apiError(res, 'your playlists');
  }
  const { playlists } = await res.json();
  return playlists ?? [];
}

export async function getPlaylist(id, { signal } = {}) {
  const res = await fetchAuthed(`/api/playlists/${encodeURIComponent(id)}`, {
    signal,
  });
  if (!res.ok) {
    throw await apiError(res, 'this playlist');
  }
  return res.json();
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

export async function deletePlaylist(id) {
  const res = await fetchAuthed(`/api/playlists/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`delete failed (${res.status})`);
  }
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

export async function removeFromPlaylist(playlistId, trackId) {
  const res = await fetchAuthed(
    `/api/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(trackId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    throw new Error(`remove failed (${res.status})`);
  }
}

// ── Collaboration ────────────────────────────────────────────────────
// Cheap poll cursor — just { updatedAt }; refetch the playlist when it changes.
export async function getPlaylistRev(id, { signal } = {}) {
  const res = await fetchAuthed(
    `/api/playlists/${encodeURIComponent(id)}/rev`,
    { signal },
  );
  if (!res.ok) {
    throw new Error(`rev failed (${res.status})`);
  }
  return res.json();
}

export async function createPlaylistInvite(id, { role } = {}) {
  const res = await fetchAuthed(
    `/api/playlists/${encodeURIComponent(id)}/invite`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `share failed (${res.status})`);
  }
  return body; // { token, role, expiresAt }
}

export async function acceptPlaylistInvite(token) {
  const res = await fetchAuthed(
    `/api/playlists/invite/${encodeURIComponent(token)}/accept`,
    { method: 'POST' },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `couldn't join (${res.status})`);
  }
  return body; // { playlistId, name, role }
}

export async function removePlaylistCollaborator(id, userId) {
  const res = await fetchAuthed(
    `/api/playlists/${encodeURIComponent(id)}/collaborators/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    throw new Error(`remove failed (${res.status})`);
  }
}

// ── Public view-only sharing ─────────────────────────────────────────
// Owner toggles whether anyone with the link can view. Returns { isPublic, publicId }.
export async function setPlaylistVisibility(id, isPublic) {
  const res = await fetchAuthed(
    `/api/playlists/${encodeURIComponent(id)}/visibility`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public: isPublic }),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `couldn't update sharing (${res.status})`);
  }
  return body; // { isPublic, publicId }
}

// Owner makes the playlist private ("only you") — revokes collaborators, kills
// invite tokens, and turns the public link off in one call.
export async function setPlaylistOnlyMe(id) {
  const res = await fetchAuthed(
    `/api/playlists/${encodeURIComponent(id)}/only-me`,
    { method: 'POST' },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `couldn't make it private (${res.status})`);
  }
  return body; // { isPublic:false, onlyMe:true }
}

// Set the cover — pass { trackId } (a playlist track's art) or { imageUrl }
// (an uploaded Blob URL). Returns { coverImageUrl }.
export async function setPlaylistCover(id, { trackId, imageUrl } = {}) {
  const res = await fetchAuthed(
    `/api/playlists/${encodeURIComponent(id)}/cover`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId, imageUrl }),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `couldn't set cover (${res.status})`);
  }
  return body; // { coverImageUrl }
}

// ── Save to library (keep someone else's playlist without editing it) ──
export async function savePlaylist(id) {
  const res = await fetchAuthed(
    `/api/playlists/${encodeURIComponent(id)}/save`,
    { method: 'POST' },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `couldn't save (${res.status})`);
  }
  return body; // { saved:true } | { saved:false, own:true }
}

export async function unsavePlaylist(id) {
  const res = await fetchAuthed(
    `/api/playlists/${encodeURIComponent(id)}/save`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    throw new Error(`couldn't remove (${res.status})`);
  }
  return { saved: false };
}

export async function listSavedPlaylists({ signal } = {}) {
  const res = await fetchAuthed('/api/playlists/saved', { signal });
  if (!res.ok) {
    throw new Error(`saved fetch failed (${res.status})`);
  }
  const { playlists } = await res.json();
  return playlists ?? [];
}

// PUBLIC read by share id — no auth, plain fetch (works signed-out). Returns
// the read-only playlist view, or throws on 404 (unknown / not public).
export async function getPublicPlaylist(publicId, { signal } = {}) {
  const res = await fetch(
    `${API_BASE}/api/public/playlists/${encodeURIComponent(publicId)}`,
    { signal },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `playlist not found (${res.status})`);
  }
  return body;
}
