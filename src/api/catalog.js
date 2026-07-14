import { fetchAuthed } from '../lib/auth';
// Client for /api/catalog/*, ported from web src/api/catalog.js (album detail
// arrives with the album screen in a later phase). Each call accepts an
// AbortSignal so stale in-flight requests can be cancelled while typing.
// Query strings are built by hand — RN's URLSearchParams is only partially
// implemented (`set` throws).

// Categorized search: best match (top) + songs / artists / albums(movies) /
// catalog playlists / the user's own playlists. `langs` (the user's languages,
// in priority order) drives "my-languages-first" ranking. Each list is empty
// when nothing matched so callers can hide the section. Artists arrive only
// when the top result isn't already an artist (server-gated).
export async function searchCatalog(
  query,
  { lang, langs, limit = 20, signal } = {},
) {
  const params = [`q=${encodeURIComponent(query)}`, `limit=${limit}`];
  if (lang) {
    params.push(`lang=${encodeURIComponent(lang)}`);
  }
  if (langs?.length) {
    params.push(`langs=${encodeURIComponent(langs.join(','))}`);
  }
  const res = await fetchAuthed(`/api/catalog/search?${params.join('&')}`, {
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `search failed (${res.status})`);
  }
  const d = await res.json();
  return {
    top: d.top ?? null,
    songs: d.songs ?? [],
    artists: d.artists ?? [],
    albums: d.albums ?? [],
    playlists: d.playlists ?? [],
    userPlaylists: d.userPlaylists ?? [],
  };
}

// Album / movie detail — { album: { ..., isMovie, artist (comma-joined
// string of every contributor), tracks } }.
export async function getAlbum(id, { signal } = {}) {
  const res = await fetchAuthed(`/api/albums/${encodeURIComponent(id)}`, {
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `album fetch failed (${res.status})`);
  }
  const { album } = await res.json();
  return album;
}

export async function getTrack(id, { signal } = {}) {
  const res = await fetchAuthed(
    `/api/catalog/track/${encodeURIComponent(id)}`,
    {
      signal,
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `track fetch failed (${res.status})`);
  }
  return res.json();
}

export async function getFeatured({ lang, limit = 20, signal } = {}) {
  const params = [`limit=${limit}`];
  if (lang) {
    params.push(`lang=${encodeURIComponent(lang)}`);
  }
  const res = await fetchAuthed(`/api/catalog/featured?${params.join('&')}`, {
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `featured failed (${res.status})`);
  }
  const { results } = await res.json();
  return results;
}
