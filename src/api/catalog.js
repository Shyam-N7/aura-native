import { fetchAuthed } from '../lib/auth';
import { storage } from '../storage/mmkv';
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

// ── resolved-track cache (docs/perf/02 layer 1) ──────────────────────────
// Stream URLs are short-lived CDN links and every play used to pay a full
// catalog round-trip for one. One choke point, so boot restore, hydration,
// deep links, and picks all inherit it: fresh-within-TTL returns instantly
// with no network; `fresh: true` bypasses AND refills (the recovery path's
// expired-URL rung). LRU-capped map in one MMKV blob + an in-memory mirror.
const TRACK_CACHE_KEY = 'aura.trackCache.v1';
const TRACK_TTL_MS = 15 * 60 * 1000;
const TRACK_CACHE_CAP = 150;
let trackMem = null;

function cacheMap() {
  if (!trackMem) {
    try {
      trackMem = new Map(
        Object.entries(
          JSON.parse(storage.getItem(TRACK_CACHE_KEY) ?? 'null') ?? {},
        ),
      );
    } catch {
      trackMem = new Map();
    }
  }
  return trackMem;
}

function cachePersist() {
  try {
    storage.setItem(
      TRACK_CACHE_KEY,
      JSON.stringify(Object.fromEntries(cacheMap())),
    );
  } catch {
    // storage full — the in-memory tier still serves this session
  }
}

function cachePut(id, track) {
  const map = cacheMap();
  map.delete(id); // re-insert = move to LRU tail
  map.set(id, { track, fetchedAt: Date.now() });
  while (map.size > TRACK_CACHE_CAP) {
    map.delete(map.keys().next().value);
  }
  cachePersist();
}

// Drop everything — both tiers. Nothing calls this in normal flow (catalog
// data is user-agnostic); it exists for tests and for a future storage-panic
// escape hatch.
export function clearTrackCache() {
  trackMem = new Map();
  try {
    storage.removeItem(TRACK_CACHE_KEY);
  } catch {
    // nothing to clear
  }
}

// Age in ms of the cached entry, or Infinity — PlayerContext uses this to
// re-resolve the NEXT track just before the transition when it's gone stale.
export function trackCacheAge(id) {
  const hit = cacheMap().get(id);
  return hit ? Date.now() - hit.fetchedAt : Infinity;
}

export async function getTrack(id, { signal, fresh } = {}) {
  if (!fresh) {
    const hit = cacheMap().get(id);
    if (hit && Date.now() - hit.fetchedAt < TRACK_TTL_MS) {
      return hit.track;
    }
  }
  const res = await fetchAuthed(
    `/api/catalog/track/${encodeURIComponent(id)}`,
    {
      signal,
      // No default deadline here, ON PURPOSE. This resolve feeds queue
      // hydration, cold restore, and error recovery — the paths that decide
      // which track plays. A deadline turns a slow success into a failure,
      // and playback semantics must not change as a side effect of the
      // fetchAuthed deadline (C4). Callers that want cancellation pass their
      // own signal, as before.
      deadlineMs: 0,
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `track fetch failed (${res.status})`);
  }
  const track = await res.json();
  if (track?.id) {
    cachePut(track.id, track);
  }
  return track;
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

// Personalized home surfaces (server/homeReco.js). Each RESOLVES NULL when the
// server has no personalization (cold-start, not deployed, or a transient
// error) — the caller then keeps its honest featured fallback. Never throws.
async function homeReco(path, signal) {
  try {
    const res = await fetchAuthed(path, { signal });
    if (!res.ok) {
      return null;
    }
    return await res.json();
  } catch {
    return null;
  }
}

// { track, reason } | null
export function getHomeHero({ signal } = {}) {
  const tz = new Date().getTimezoneOffset();
  return homeReco(`/api/home/hero?tzOffset=${tz}`, signal);
}
// { tracks } | null
export function getHomeNewForYou({ signal } = {}) {
  return homeReco('/api/home/new-for-you', signal);
}
// { stations: [{ seedId, title, artist, imageUrl, language, reason }] } | null
export function getHomeStations({ signal } = {}) {
  return homeReco('/api/home/stations', signal);
}
