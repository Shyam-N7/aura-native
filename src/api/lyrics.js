import { fetchAuthed } from '../lib/auth';
import { apiError } from './apiError';
// Ported from web src/api/lyrics.js. Returns the same shape as the server:
//   { available: true,  synced: true,  lines: [{t, line, line_en?}], has_english, source }
//   { available: true,  synced: false, lines: [{line, line_en?}],    has_english, source } // plain, untimed
//   { available: false, synced: false, pending: true }   // being generated — poll again
//   { available: false, synced: false }                  // no lyrics anywhere
//
// First-fetch of a song is slow server-side (provider call + romanization),
// then cached in Postgres for 7 days. To hide that latency we (a) prefetch the
// current + next track when playback settles (PlayerContext) so the server
// cache is warm before the overlay opens, and (b) keep an in-session client
// cache + in-flight dedup here so a prefetch and the overlay-open share one
// request and re-opening a song is instant.

const cache = new Map(); // trackId -> terminal data (synced / not-available)
const inflight = new Map(); // trackId -> Promise<data> while a request is open

// One entry is a whole romanized lyric sheet (often 40–80 timed lines), and
// auto-radio can play for hours without a re-launch, so the cache is capped
// rather than left to grow for the life of the process. Map iterates in
// insertion order, so the oldest song drops out first — re-opening it just
// re-fetches from the server cache, which is the fast path anyway.
const CACHE_MAX = 60;

function cacheTerminal(trackId, data) {
  if (cache.size >= CACHE_MAX) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(trackId, data);
}

// Hermes has no DOMException — an Error wearing the AbortError name keeps the
// web's `err.name === 'AbortError'` checks working.
function abortError() {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

async function fetchLyrics(trackId) {
  // No AbortSignal here on purpose: a prefetch (or a fetch whose overlay
  // closed) must still finish and populate the cache. Callers that want to
  // ignore a stale result use the signal wrapper below + their own guard.
  const res = await fetchAuthed(`/api/lyrics/${encodeURIComponent(trackId)}`);
  if (!res.ok) {
    throw await apiError(res, 'the lyrics');
  }
  return res.json();
}

// Reject the CALLER's promise if its signal aborts, without cancelling the
// shared underlying fetch (so a prefetch keeps warming the cache).
function withSignal(promise, signal) {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(abortError());
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      v => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      e => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

export function getLyrics(trackId, { signal } = {}) {
  if (cache.has(trackId)) {
    return withSignal(Promise.resolve(cache.get(trackId)), signal);
  }

  let p = inflight.get(trackId);
  if (!p) {
    p = fetchLyrics(trackId)
      .then(data => {
        inflight.delete(trackId);
        // Cache only terminal results. A 'pending' (still generating) result
        // must stay re-fetchable so the overlay's re-poll sees fresh state.
        if (data && !data.pending) {
          cacheTerminal(trackId, data);
        }
        return data;
      })
      .catch(err => {
        inflight.delete(trackId);
        throw err;
      });
    inflight.set(trackId, p);
  }
  return withSignal(p, signal);
}

// Warm the cache for a track in the background (fire-and-forget). Cheap to
// call repeatedly — dedupes against any in-flight/cached entry.
export function prefetchLyrics(trackId) {
  if (!trackId) {
    return;
  }
  getLyrics(trackId).catch(() => {});
}
