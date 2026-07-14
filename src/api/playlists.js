import { fetchAuthed } from '../lib/auth';
// Ported from web src/api/playlists.js — Phase 2 needs only the list (the home
// "your playlists" shelf); the full CRUD/sharing surface arrives with Phase 3.

export async function listPlaylists({ signal } = {}) {
  const res = await fetchAuthed('/api/playlists', { signal });
  if (!res.ok) {
    throw new Error(`playlists fetch failed (${res.status})`);
  }
  const { playlists } = await res.json();
  return playlists ?? [];
}
