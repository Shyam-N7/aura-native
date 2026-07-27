// Playback-failure policy (docs/perf/03): pure functions so the timing and
// classification rules are testable without a player. engine.js owns the
// ladder; these decide WHICH rung and WHEN.

// RNTP surfaces ExoPlayer failures as string codes like
// 'android-io-bad-http-status' (message carries "Response code: NNN"),
// 'android-io-network-connection-failed' / '-timeout',
// 'android-io-file-not-found', 'android-parsing-*', 'android-decoder-*'.
export function classifyPlaybackError(e) {
  const code = String(e?.code ?? '');
  const msg = String(e?.message ?? '');
  if (code.includes('network-connection')) {
    return 'network'; // includes timeouts — retry same URL with backoff
  }
  if (code.includes('bad-http-status')) {
    if (/\b404\b/.test(msg)) {
      return 'gone'; // one re-resolve, then skip — never hammer a 404
    }
    if (/\b5\d\d\b/.test(msg)) {
      return 'network'; // server-side wobble — same-URL backoff is correct
    }
    // 401/403/410 and anything unspecified: treat as an expired CDN link.
    // Re-resolving is cheap and correct; retrying the same URL never is.
    return 'expired';
  }
  if (code.includes('file-not-found')) {
    return 'gone';
  }
  if (code.includes('parsing') || code.includes('decoder')) {
    return 'malformed'; // reload once, ladder down, then skip
  }
  return 'unknown';
}

// 0 → instant (transient CDN hiccups dominate; a silent second is audible),
// then 1s / 3s / 8s with ±30% jitter so a fleet-wide outage doesn't retry in
// lockstep against one origin.
const SCHEDULE = [0, 1000, 3000, 8000];

export function retryDelayMs(attempt, rand = Math.random()) {
  const base = SCHEDULE[Math.min(Math.max(attempt, 0), SCHEDULE.length - 1)];
  return Math.round(base * (0.7 + rand * 0.6));
}

// Hard ceilings (docs/perf/03): beyond these the honest states are
// offline-waiting or skip, not more retrying.
export const MAX_ATTEMPTS = 6;
export const MAX_RECOVERY_MS = 20000;
