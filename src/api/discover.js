import { fetchAuthed } from '../lib/auth';
// Ported from web src/api/discover.js.

export async function getDiscoverHome({ lang, signal } = {}) {
  const qs = lang ? `?lang=${encodeURIComponent(lang)}` : '';
  const res = await fetchAuthed(`/api/discover/home${qs}`, { signal });
  if (!res.ok) {
    throw Object.assign(new Error(`discover failed (${res.status})`), {
      status: res.status,
    });
  }
  return res.json();
}

export async function getCatalogPlaylist(id, { signal } = {}) {
  const res = await fetchAuthed(
    `/api/discover/playlist/${encodeURIComponent(id)}`,
    { signal },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      body.error || `catalog playlist fetch failed (${res.status})`,
    );
  }
  return res.json();
}
