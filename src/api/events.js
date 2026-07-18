import { fetchAuthed } from '../lib/auth';
import { isPrivateSession } from '../lib/privateSession';
import { invalidateHomeCache } from '../lib/homeCache';
// Fire-and-forget listening event recorder, ported from web src/api/events.js
// (postEvent(track_id, kind, opts) reshaped to recordEvent(evt) per the native
// contract). Failures are logged to console but never surface to the user —
// recording is a background concern.

// Every ~5 listens, drop Home's listening-derived caches so the picks refresh
// within the session (they trail the actual plays otherwise). Only the
// signal-driven sections — NOT the editorial featured pool, which is keyed by
// mode elsewhere.
const INVALIDATE_EVERY = 5;
const LISTEN_KEYS = [
  'recentlyPlayed',
  'quickPicks',
  'mostPlayed',
  'topArtists',
];
let listensSinceInvalidate = 0;

export function recordEvent(evt = {}) {
  const { track_id, kind } = evt;
  if (!track_id || !kind) {
    return;
  }
  // Private session: the play happens, the profile never hears about it.
  if (isPrivateSession()) {
    return;
  }
  if (kind === 'play' || kind === 'end') {
    listensSinceInvalidate += 1;
    if (listensSinceInvalidate >= INVALIDATE_EVERY) {
      listensSinceInvalidate = 0;
      invalidateHomeCache(...LISTEN_KEYS);
    }
  }
  fetchAuthed('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      track_id,
      kind,
      position_sec: evt.position_sec ?? null,
      mood: evt.mood ?? null,
      language: evt.language ?? null,
      mode: evt.mode ?? null,
      source: evt.source ?? null,
    }),
  }).catch(err =>
    console.warn('[events] post failed', kind, track_id, err.message),
  );
}
