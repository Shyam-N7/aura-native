import { fetchAuthed } from '../lib/auth';
import { apiError } from './apiError';
import { onSessionReset } from '../lib/sessionReset';

// YouTube import — the client side of /api/import/youtube.
//
// Ported from web src/api/ytImport.js. One rule shapes the whole file there and
// here: THE CODE SURVIVES. The server answers every failure with {error, code},
// and the UI renders from `code` via ../lib/ytImportCopy — that indirection is
// the entire reason a wording change needs no server deploy and every case gets
// text written for it. The web hand-rolled a `fail()` helper to preserve it;
// this app already has one (./apiError attaches `status` and `code`, and writes
// a better fallback message), so that is what is used below.

// ── The deadline, which we have to own here ─────────────────────────
//
// fetchAuthed (lib/auth.js:555) applies its 15s deadline ONLY when the caller
// passes no signal:
//
//     if (!signal && deadlineMs > 0) { …abort after deadlineMs }
//
// Every call in this file that takes a caller signal therefore gets NO timeout
// at all, because RN's fetch has none of its own. For pollImport that is not
// untidy, it is fatal: useImportJob awaits the poll BEFORE scheduling the next
// tick, and the poll IS the worker (there is no background job runner — each
// GET performs a slice of the matching). One socket that never answers and the
// import stops dead, with the screen still reading "we'll keep going".
//
// So this module composes its own: one controller carrying both the caller's
// abort and a timer. The timeout surfaces as a TimeoutError with code
// YT_TIMEOUT, deliberately NOT as an AbortError — the hook reads AbortError as
// "we stopped on purpose" and would not reschedule, which is the exact silent
// death this exists to prevent. YT_TIMEOUT is already in IMPORT_ERRORS and
// already marked retryable.
async function withDeadline(ms, outer, run) {
  const ctl = new AbortController();
  // An already-cancelled caller (a debounce that fired its cleanup while we
  // were being called) must not leak a request.
  if (outer?.aborted) {
    ctl.abort();
  }
  const relay = () => ctl.abort();
  outer?.addEventListener?.('abort', relay);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, ms);
  try {
    return await run(ctl.signal);
  } catch (err) {
    if (timedOut) {
      throw Object.assign(new Error('that took too long'), {
        name: 'TimeoutError',
        code: 'YT_TIMEOUT',
      });
    }
    throw err;
  } finally {
    // auth.js names an uncleared timer as "the jest leaked-handle class"; the
    // listener is the same story one level up.
    clearTimeout(timer);
    outer?.removeEventListener?.('abort', relay);
  }
}

// The server holds POST / and POST /refresh open for a bounded 20s drain
// (importRoutes.js POST_BUDGET_MS) plus the YouTube fetch, so the 15s default
// would abort a healthy import while the server was still working on it.
// uploads.js:18 is the precedent for opting out.
const WRITE_DEADLINE_MS = 45000;
// The server's own slice is bounded at 15s (POLL_BUDGET_MS); this leaves room
// for a slow uplink without letting a dead socket hang forever.
const POLL_DEADLINE_MS = 30000;

const json = body => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ── Feature flag ────────────────────────────────────────────────────

// Fetched once per session. The web calls this on every playlist-detail mount;
// on a phone that is a round trip every time any playlist opens, in order to
// render nothing for the ~99% that never came from YouTube.
let featuresPromise = null;

/**
 * Which env-gated features this deployment has.
 *
 * Called before the entry point renders. An import button that leads to a 503
 * is worse than no button, and the screens ship whether or not the key is set.
 * Never throws — a features call that fails means "assume off", which fails in
 * the safe direction.
 */
export function getFeatures({ signal } = {}) {
  if (!featuresPromise) {
    featuresPromise = withDeadline(10000, signal, s =>
      fetchAuthed('/api/features', { signal: s }).then(res =>
        res.ok ? res.json() : {},
      ),
    ).catch(() => {
      // Do not cache a failure — the next screen should get a fresh attempt.
      featuresPromise = null;
      return {};
    });
  }
  return featuresPromise;
}

// ── Link classification ─────────────────────────────────────────────

/**
 * Classify a pasted link. Zero API calls server-side and zero writes, so this is
 * safe to call on every paste.
 *
 * It is also the only thing standing between the user and a spinner that
 * finishes having imported nothing: Watch Later and History return an EMPTY
 * LIST rather than an error from YouTube, so they can only be caught here.
 */
export async function previewLink(url, { signal } = {}) {
  return withDeadline(15000, signal, async s => {
    const res = await fetchAuthed('/api/import/youtube/preview', {
      ...json({ url }),
      signal: s,
    });
    if (!res.ok) {
      throw await apiError(res, 'that link');
    }
    return res.json();
  });
}

// ── The job ─────────────────────────────────────────────────────────

/** Start an import. Returns the job view — often already finished for a small playlist. */
export async function startImport(url) {
  const res = await fetchAuthed('/api/import/youtube', {
    ...json({ url }),
    deadlineMs: WRITE_DEADLINE_MS,
  });
  if (!res.ok) {
    throw await apiError(res, 'the import');
  }
  return res.json();
}

/**
 * Poll a job — and, on the server, drive one slice of the work.
 *
 * Worth knowing at the call site: this is not a read. There is no background
 * worker on the deployment, so the poll IS the worker. Polling faster does more
 * work; not polling stops it (until the daily cron picks it up). That is why
 * the polling hook stops on unmount rather than running loose.
 */
export async function pollImport(jobId, { signal } = {}) {
  return withDeadline(POLL_DEADLINE_MS, signal, async s => {
    const res = await fetchAuthed(
      `/api/import/youtube/${encodeURIComponent(jobId)}`,
      { signal: s },
    );
    if (!res.ok) {
      throw await apiError(res, 'that import');
    }
    return res.json();
  });
}

/** Accept a candidate for a review item, or skip it. Returns {pending, accepted}. */
export async function resolveItem(
  jobId,
  itemId,
  { trackId = null, skip = false } = {},
) {
  const res = await fetchAuthed(
    `/api/import/youtube/${encodeURIComponent(jobId)}/items/${encodeURIComponent(itemId)}`,
    json({ trackId, skip }),
  );
  if (!res.ok) {
    throw await apiError(res, 'that choice');
  }
  return res.json();
}

/**
 * Stop an import in flight.
 *
 * Does not delete the playlist or the songs already added — the user asked to
 * stop importing, not to lose what arrived. COPY.cancel.body says so before
 * they confirm.
 */
export async function cancelImport(jobId) {
  const res = await fetchAuthed(
    `/api/import/youtube/${encodeURIComponent(jobId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    throw await apiError(res, 'that import');
  }
  return res.json();
}

// ── Refresh ─────────────────────────────────────────────────────────

/**
 * Playlists that came from a YouTube source we can check again.
 *
 * Only finite playlists appear. A mix regenerates every time YouTube builds it,
 * so there is nothing stable to refresh against — absence from this list is
 * what hides the refresh button, rather than a flag on the playlist.
 */
export async function listLinks({ signal } = {}) {
  return withDeadline(15000, signal, async s => {
    const res = await fetchAuthed('/api/import/youtube/links', { signal: s });
    if (!res.ok) {
      throw await apiError(res, 'your imported playlists');
    }
    const { links } = await res.json();
    return links ?? [];
  });
}

// The link set, fetched once per session.
//
// Every playlist-detail view needs one bit — did this come from a YouTube source
// we can check again? — and for almost every playlist the honest answer is no.
// Asking the server per view would put a request on the ~99% that never came
// from YouTube, in order to render nothing. The set only changes when an import
// or a refresh runs, and both invalidate it.
let linksPromise = null;

export function invalidateYtLinks() {
  linksPromise = null;
}

// A link set belongs to the account that owns those playlists, and the flag to
// the session that asked. Both die with the session rather than leaking into
// the next sign-in.
onSessionReset(() => {
  linksPromise = null;
  featuresPromise = null;
});

/**
 * The link row for a playlist, or null.
 *
 * Null is the gate for the entire refresh feature. finishJob writes a link row
 * ONLY for a finite playlist, never for a mix — a mix regenerates every time
 * YouTube builds it, so there is no stable source to diff against. "No row" and
 * "not refreshable" are therefore the same statement, and the UI needs no
 * separate kind check.
 *
 * Never throws. A failed lookup means the button does not render — the same
 * outcome as no link, which fails toward absence rather than toward a button
 * that leads nowhere.
 */
export async function getYtLink(playlistId, { signal } = {}) {
  if (!playlistId) {
    return null;
  }
  if (!linksPromise) {
    linksPromise = listLinks({ signal }).catch(() => {
      // Do not cache a failure — the next view should get a fresh attempt.
      linksPromise = null;
      return [];
    });
  }
  const links = await linksPromise;
  // snake_case on purpose: listLinks returns rows straight from SQL (see
  // importJobs.listLinks), unlike every other camelCase payload in this client.
  return links.find(l => l.playlist_id === playlistId) ?? null;
}

/** Check for new songs and import them. `{changed:false}` is the common answer. */
export async function refreshPlaylist(playlistId) {
  const res = await fetchAuthed('/api/import/youtube/refresh', {
    ...json({ playlistId }),
    deadlineMs: WRITE_DEADLINE_MS,
  });
  if (!res.ok) {
    throw await apiError(res, 'new songs');
  }
  // A refresh can create the very first link row for a playlist, and always
  // moves last_synced_at. Drop the cache so the next view reads the truth.
  invalidateYtLinks();
  return res.json();
}

/** Statuses where the server still has work to do for this job. */
export const LIVE_STATUSES = ['queued', 'fetching', 'matching'];
export const isLive = status => LIVE_STATUSES.includes(status);
