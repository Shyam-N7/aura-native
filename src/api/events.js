import { fetchAuthed } from '../lib/auth';
// Fire-and-forget listening event recorder, ported from web src/api/events.js
// (postEvent(track_id, kind, opts) reshaped to recordEvent(evt) per the native
// contract). Failures are logged to console but never surface to the user —
// recording is a background concern.

// Every ~5 listens the web drops Home's listening-derived caches so quick
// picks refresh within the session. The counter is kept so behaviour matches
// when Phase 2 ports src/lib/homeCache.js and fills in this hook.
const INVALIDATE_EVERY = 5;
let listensSinceInvalidate = 0;

function invalidateHomeCache() {}

export function recordEvent(evt = {}) {
  const { track_id, kind } = evt;
  if (!track_id || !kind) {
    return;
  }
  if (kind === 'play' || kind === 'end') {
    listensSinceInvalidate += 1;
    if (listensSinceInvalidate >= INVALIDATE_EVERY) {
      listensSinceInvalidate = 0;
      invalidateHomeCache();
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
