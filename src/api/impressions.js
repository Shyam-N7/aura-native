import { fetchAuthed } from '../lib/auth';
import { isPrivateSession } from '../lib/privateSession';
import { onSessionReset } from '../lib/sessionReset';

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

// The guard is keyed by (surface, day) with no account in it, so it also
// survived an account SWITCH: the new user's first Home visit was silently
// treated as already logged, and their impressions never reached the ranker
// until the next calendar day.
export function _resetImpressionGuard() {
  logged.clear();
}

onSessionReset(_resetImpressionGuard);
