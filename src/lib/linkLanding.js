import { API_BASE } from './auth';
import { onSessionReset } from './sessionReset';
import { fmtTime } from '../utils/fmtTime';

// The contextual link-landing: when a tapped notification or shared link is
// carrying the app somewhere, the FIRST paint should say where — "opening the
// song", "starting from 1:24" — instead of a vague home flash while the boot
// and the fetch run. This module owns the one URL parser (App.handleLink
// consumes it too: a drifted second parser would show a landing the router
// then drops, i.e. a stuck overlay) and a toast-pattern bus for the host.

// Only OUR links are actionable. Both hosts the manifest declares an intent
// filter for — www (autoVerify) and the apex (chooser) — derived from the one
// origin the app talks to rather than restated.
export const LINK_HOSTS = new Set([
  new URL(API_BASE).hostname,
  new URL(API_BASE).hostname.replace(/^www\./, ''),
]);

// `new URL` parses anything, so pathname/searchParams alone say nothing about
// WHO sent the link — and every feed into the router is untrusted. MainActivity
// is exported and singleTask, so any installed app can send an explicit-component
// ACTION_VIEW carrying an arbitrary URI and bypass the manifest's host filter
// entirely; and push data.link is free text typed in the admin console. The
// branch that actually costs something is `join`, which POSTs an invite
// acceptance under the signed-in user — a link from anywhere could enrol them
// in a stranger's playlist. Scheme is pinned too: http:// and app:// forms of
// our own host must not count.
export const isOwnLink = u => u.protocol === 'https:' && LINK_HOSTS.has(u.hostname);

/**
 * The one classifier. Pure and throw-safe: a malformed or foreign link is
 * null, never an exception — this runs synchronously inside the native 'url'
 * callback and push's linkHandler, where a throw kills the app.
 *
 * Returns { kind: 'song'|'moment'|'playlist'|'invite', ...facts } or null.
 * An invalid ?at degrades moment → song rather than dropping the link.
 */
export function classifyLink(url) {
  if (!url) {
    return null;
  }
  let parsed;
  let params;
  try {
    parsed = new URL(url);
    // RN's URLSearchParams decodes every pair in its constructor, so a
    // truncated % escape throws URIError here, not in new URL. A malformed
    // link is dropped instead.
    params = parsed.searchParams;
  } catch {
    return null;
  }
  if (!isOwnLink(parsed)) {
    return null;
  }
  const join = params.get('join');
  if (join) {
    return { kind: 'invite', token: join };
  }
  if (parsed.pathname.startsWith('/p/')) {
    const publicId = parsed.pathname.slice(3).split('/')[0];
    return publicId ? { kind: 'playlist', publicId } : null;
  }
  if (parsed.pathname.startsWith('/t/')) {
    const trackId = parsed.pathname.slice(3).split('/')[0];
    if (!trackId) {
      return null;
    }
    const at = Number(params.get('at'));
    return Number.isFinite(at) && at > 0
      ? { kind: 'moment', trackId, at }
      : { kind: 'song', trackId, at: null };
  }
  return null;
}

// The landing's line knows its errand. No trailing ellipsis — the loader's
// pulsing blobs already say "ongoing" (house style: 'loading playlist').
export function landingLabel(ev) {
  switch (ev?.kind) {
    case 'moment':
      return `starting from ${fmtTime(ev.at)}`;
    case 'song':
      return 'opening the song';
    case 'playlist':
      return 'opening the playlist';
    case 'invite':
      return 'joining the playlist';
    default:
      return '';
  }
}

// ── The bus (toast.js pattern: fire-and-forget, one host, last-write-wins) ──
const subscribers = new Set();
let counter = 0;
// A landing shown before the host mounts (cold start: the early read fires
// frames before Shell's children exist) is held and replayed to the first
// subscriber. Short TTL: a landing replayed later than its own safety window
// would be worse than none.
const PENDING_TTL_MS = 10_000;
let pending = null;

export function showLanding(cls) {
  if (!cls) {
    return;
  }
  const event = { id: ++counter, kind: cls.kind, at: cls.at ?? null };
  if (subscribers.size === 0) {
    pending = { event, at: Date.now() };
    return;
  }
  for (const cb of subscribers) {
    cb(event);
  }
}

export function hideLanding() {
  pending = null;
  for (const cb of subscribers) {
    cb(null);
  }
}

export function subscribeLanding(cb) {
  subscribers.add(cb);
  if (pending) {
    const { event, at } = pending;
    pending = null;
    if (Date.now() - at < PENDING_TTL_MS) {
      cb(event);
    }
  }
  return () => {
    subscribers.delete(cb);
  };
}

// A landing belongs to the account that tapped the link — sign-out must not
// leave one hovering over whoever signs in next.
onSessionReset(() => {
  pending = null;
  for (const cb of subscribers) {
    cb(null);
  }
});
