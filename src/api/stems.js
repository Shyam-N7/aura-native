import { fetchAuthed } from '../lib/auth';

// Karaoke "music only" — ask the server for this track's instrumental. One
// idempotent endpoint: the first call starts the (minutes-long, cached-for-
// everyone) separation, later calls report progress, 'done' carries the Blob
// url. Statuses: done | preparing | waiting | failed | unavailable (server
// not configured) | error (network) — the caller keeps the full mix on
// anything that isn't done.
export async function requestStems(trackId, { signal } = {}) {
  try {
    const res = await fetchAuthed('/api/stems/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId }),
      signal,
    });
    if (!res.ok) {
      return { status: res.status === 501 ? 'unavailable' : 'error' };
    }
    return await res.json();
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw err;
    }
    return { status: 'error' };
  }
}
