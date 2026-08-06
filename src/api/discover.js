import { fetchAuthed } from '../lib/auth';
import { apiError } from './apiError';
// Ported from web src/api/discover.js.

export async function getDiscoverHome({ lang, signal } = {}) {
  const qs = lang ? `?lang=${encodeURIComponent(lang)}` : '';
  const res = await fetchAuthed(`/api/discover/home${qs}`, { signal });
  if (!res.ok) {
    throw await apiError(res, 'discover');
  }
  return res.json();
}

export async function getCatalogPlaylist(id, { signal } = {}) {
  const res = await fetchAuthed(
    `/api/discover/playlist/${encodeURIComponent(id)}`,
    { signal },
  );
  if (!res.ok) {
    throw await apiError(res, 'this playlist');
  }
  return res.json();
}
