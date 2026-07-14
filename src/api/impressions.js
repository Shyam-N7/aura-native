import { fetchAuthed } from '../lib/auth';
import { isPrivateSession } from '../lib/privateSession';

// Fire-and-forget impression logger, ported from web src/api/impressions.js:
// records that these tracks were SHOWN on a surface, so the server ranker can
// demote shown-but-never-played picks. Guarded to once per (surface, day) per
// app session — revisiting Home the same day doesn't re-log. Failures are
// swallowed and the guard released so a later attempt can retry.
const logged = new Set();

export function logImpressions(surface, trackIds) {
  if (!surface || !Array.isArray(trackIds) || !trackIds.length) {
    return;
  }
  // Private session: what's shown stays out of the ranker too.
  if (isPrivateSession()) {
    return;
  }
  const key = `${surface}|${new Date().toISOString().slice(0, 10)}`;
  if (logged.has(key)) {
    return;
  }
  logged.add(key);
  fetchAuthed('/api/impressions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      surface,
      tzOffset: new Date().getTimezoneOffset(),
      track_ids: trackIds.slice(0, 40),
    }),
  }).catch(() => {
    logged.delete(key);
  });
}

// Test seam — the guard is module state that survives between specs.
export function _resetImpressionGuard() {
  logged.clear();
}
