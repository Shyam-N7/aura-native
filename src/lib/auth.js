import { storage } from '../storage/mmkv';

// Port of web src/lib/auth.js. Native differences: the session is a JWT kept
// in MMKV (not an httpOnly cookie) and injected as a Bearer header on every
// authed call; session-creating calls identify as the native client so the
// server returns { token } in the body. Web-only surface (BroadcastChannel
// tab sync, service-worker cache purge, Google login, devices/family/modes
// management) is dropped until the phase that needs it.

export const API_BASE = 'https://www.aurafm.live';

const TOKEN_KEY = 'aura.authToken';
const USER_KEY = 'aura.authUser';

const subscribers = new Set();

function notify() {
  subscribers.forEach(fn => fn());
}

// Dev-only request trace for the auth flow (stripped from release builds).
const trace = (...a) => {
  if (__DEV__) {
    console.log('[auth]', ...a);
  }
};

const JSON_HEADERS = { 'Content-Type': 'application/json' };
// Session-creating calls carry this so the server returns the JWT in the
// response body instead of relying on a cookie.
const NATIVE_JSON_HEADERS = { ...JSON_HEADERS, 'X-Aura-Client': 'native' };

// Identity is read through MMKV (synchronous) rather than cached in a module
// variable — a login/logout anywhere in the app can never go stale here.
export function getUser() {
  const raw = storage.getItem(USER_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function isSignedIn() {
  return !!storage.getItem(TOKEN_KEY) && !!getUser();
}

// Subscribers are notified with no args and re-read getUser() (web semantics).
export function subscribeAuth(fn) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

// Persist the user identity + the synchronous "derived" caches (hasOnboarded /
// seed* — read before first paint by later screens) and notify subscribers.
// Shared by login (setSession) AND every later server refresh (fetchMe), so a
// normal refresh reconciles ALL cached bits — server-side changes (e.g. fields
// added by a migration) show up WITHOUT a logout/login.
function persistUser(user) {
  // Validate BEFORE the first write. Field symptom: a 200 with no `user` in
  // the body wrote JSON.stringify(undefined) — storage String()s it, so the
  // literal "undefined" landed in aura.authUser — and then threw on the next
  // line. Every later getUser() failed to parse it, so the app read as signed
  // out, permanently, across restarts, with nothing surfaced. A bad payload
  // must be a no-op, never a half-write.
  if (!user || typeof user !== 'object') {
    return;
  }
  storage.setItem(USER_KEY, JSON.stringify(user));
  // No 'aura.hasOnboarded' mirror. It was written here and by markOnboarded,
  // cleared on sign-out, and read by NOTHING — hasOnboarded() below reads
  // getUser()?.hasOnboarded, i.e. the authUser blob written on the line above,
  // so the flag was pure write amplification pretending to be a cache.
  if (user.seedArtists) {
    storage.setItem('aura.seedArtists', JSON.stringify(user.seedArtists));
  }
  if (user.seedLanguages) {
    storage.setItem('aura.seedLanguages', JSON.stringify(user.seedLanguages));
  }
  if (user.seedMood !== undefined) {
    storage.setItem('aura.seedMood', user.seedMood ?? '');
  }
  notify();
}

// Login establishes the session — the body token plus the same client
// persistence as any later refresh.
function setSession(data) {
  if (data.token) {
    storage.setItem(TOKEN_KEY, data.token);
  }
  persistUser(data.user);
}

export function clearSession() {
  [
    TOKEN_KEY,
    USER_KEY,
    'aura.seedArtists',
    'aura.seedLanguages',
    'aura.seedMood',
    'aura.queue',
    'aura.position',
    'aura.talkHistory',
    'aura.recentSearches',
    // A private-listening window is one account's decision — a wall-clock
    // deadline left behind here silently suppressed the NEXT account's events,
    // impressions and presence for up to six hours.
    'aura.privateUntil',
  ].forEach(k => storage.removeItem(k));
  notify();
}

export async function signup(name, email, password) {
  const res = await fetch(`${API_BASE}/api/auth/signup`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, name, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw Object.assign(new Error(data.error ?? 'signup failed'), {
      status: res.status,
      code: data.code,
    });
  }
  // No session yet — the account stays unverified until the emailed code is
  // entered (verifyOtp). Returns { pendingVerification, email }.
  return data;
}

export async function login(email, password, evictSessionId) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: NATIVE_JSON_HEADERS,
    body: JSON.stringify({ email, password, evictSessionId }),
  });
  const data = await res.json();
  // Unverified account isn't an error — route the caller to the OTP step.
  if (res.status === 403 && data.pendingVerification) {
    return { pendingVerification: true, email: data.email };
  }
  // Hard device cap hit — hand the caller the device list so it can let the
  // user remove one and retry (with evictSessionId). Not an error to surface.
  if (res.status === 403 && data.code === 'device_limit') {
    return {
      deviceLimit: true,
      code: 'device_limit',
      sessions: data.sessions ?? [],
      limit: data.limit,
    };
  }
  if (!res.ok) {
    throw Object.assign(new Error(data.error ?? 'login failed'), {
      status: res.status,
      code: data.code,
    });
  }
  setSession(data);
  return data.user;
}

// Verify the signup code. On success the account activates and a session is
// created — the only session-creating call on the signup path.
export async function verifyOtp(email, code, evictSessionId) {
  const res = await fetch(`${API_BASE}/api/auth/verify-otp`, {
    method: 'POST',
    headers: NATIVE_JSON_HEADERS,
    body: JSON.stringify({ email, code, evictSessionId }),
  });
  const data = await res.json();
  if (res.status === 403 && data.code === 'device_limit') {
    return {
      deviceLimit: true,
      code: 'device_limit',
      sessions: data.sessions ?? [],
      limit: data.limit,
    };
  }
  if (!res.ok) {
    throw Object.assign(new Error(data.error ?? 'verification failed'), {
      status: res.status,
      code: data.code,
      attemptsLeft: data.attemptsLeft,
    });
  }
  setSession(data);
  return data.user;
}

// Re-send the signup code. Returns { ok, cooldownSec }; throws on cooldown 429.
export async function resendOtp(email) {
  const res = await fetch(`${API_BASE}/api/auth/resend-otp`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw Object.assign(new Error(data.error ?? 'could not resend code'), {
      status: res.status,
      code: data.code,
      retryAfterSec: data.retryAfterSec,
    });
  }
  return data;
}

// Request a password-reset code (web: requestReset). Anti-enumeration:
// resolves for any normal response. Returns { ok, cooldownSec }; throws on
// cooldown 429.
export async function forgotRequest(email) {
  trace('forgotRequest →', email);
  const res = await fetch(`${API_BASE}/api/auth/forgot`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  trace('/forgot', res.status, data);
  if (!res.ok) {
    throw Object.assign(new Error(data.error ?? 'request failed'), {
      status: res.status,
      code: data.code,
      retryAfterSec: data.retryAfterSec,
    });
  }
  return data;
}

// Verify a reset code WITHOUT consuming it (web: verifyResetCode) — gates the
// new-password step so a wrong code is caught before the user types a
// password. Returns { ok: true }; throws with { status, code, attemptsLeft }
// on a bad/expired/locked code.
export async function verifyResetOtp(email, code) {
  trace('verifyResetOtp →', email, `(code len ${String(code).length})`);
  const res = await fetch(`${API_BASE}/api/auth/verify-reset-otp`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, code }),
  });
  const data = await res.json();
  trace('/verify-reset-otp', res.status, data);
  if (!res.ok) {
    throw Object.assign(new Error(data.error ?? 'verification failed'), {
      status: res.status,
      code: data.code,
      attemptsLeft: data.attemptsLeft,
    });
  }
  return data;
}

// Verify the reset code + set a new password. Does NOT create a session — the
// user re-logs in with the new password afterward. Returns { ok: true }.
export async function resetPassword(email, code, password) {
  trace('resetPassword →', email, `(code len ${String(code).length})`);
  const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, code, password }),
  });
  const data = await res.json();
  trace('/reset-password', res.status, res.ok ? '→ ok (re-login)' : data);
  if (!res.ok) {
    throw Object.assign(new Error(data.error ?? 'reset failed'), {
      status: res.status,
      code: data.code,
      attemptsLeft: data.attemptsLeft,
    });
  }
  return data;
}

export async function fetchMe() {
  // Reconcile the cached identity with the server. A network/5xx blip KEEPS
  // the cached user (just skips the update) so a boot refresh can't sign you
  // out on a transient hiccup; only a definitive 401/403 (revoked / expired /
  // deleted session) clears it. Raw fetch, not fetchAuthed — a 401 here must
  // not re-trigger the revalidation that called us.
  let res;
  try {
    res = await fetch(`${API_BASE}/api/auth/me`, { headers: authHeaders() });
  } catch {
    return getUser();
  }
  if (res.status === 401 || res.status === 403) {
    clearSession();
    return null;
  }
  if (!res.ok) {
    return getUser();
  }
  // A 200 that carries no user (server regression, edge-cached wrong body, a
  // gateway 200ing an error envelope) is the same class as the blip above —
  // keep the cached identity rather than reconciling against nothing.
  const data = await res.json().catch(() => ({}));
  if (!data.user) {
    return getUser();
  }
  persistUser(data.user);
  return data.user;
}

// Profile photo — set to an uploaded Blob URL / clear back to the initial
// monogram. persistUser refreshes every avatar on screen (web parity).
export async function setMyAvatar(imageUrl) {
  const res = await fetchAuthed('/api/auth/me/avatar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error ?? 'update failed');
  }
  persistUser(data.user);
  return data.user;
}

export async function clearMyAvatar() {
  const res = await fetchAuthed('/api/auth/me/avatar', { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error ?? 'update failed');
  }
  persistUser(data.user);
  return data.user;
}

// Whether the active mode hides explicit content — api/related filters through
// this. Falls back to familyMode for sessions cached before modes existed.
export function getActiveExplicitOff() {
  const u = getUser();
  if (!u) {
    return false;
  }
  const key = u.activeMode ?? 'everyday';
  const m = (u.modes ?? []).find(x => x.key === key);
  return m ? !!m.explicitOff : !!u.familyMode;
}

// ── Preferences (onboarding seeds, sensing toggle, dj name) ──────────
export async function updatePreferences(prefs) {
  const res = await fetchAuthed('/api/auth/me/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error ?? 'update failed');
  }
  persistUser(data.user);
  return data.user;
}

// Read before first paint by App's screen gate — synchronous, from the cached
// identity (mirrors the web readers). hasOnboarded reads the cached user (the
// seed caches are for later personalization, not the gate).
export function hasOnboarded() {
  return !!getUser()?.hasOnboarded;
}

// The "sensing" welcome is a per-user preference; default ON when the field is
// absent (a session cached before it existed) so behaviour is unchanged.
export function showSensing() {
  return getUser()?.showSensing !== false;
}

// ── Listening modes ──────────────────────────────────────────────────
// Switch the active context. Returns the refreshed user (activeMode + the
// modes view) and updates the session so the UI reacts at once (home refetches
// the mode-seeded pool). No cross-tab broadcast — that's a web-only concern.
export async function setActiveMode(key) {
  // Optimistic: flip the mode locally FIRST so the sheet can close instantly
  // and Home re-seeds right away — the network confirms (or reverts) behind
  // it. Without this the picker sat on a spinner through the round-trip AND
  // the home refetch, which read as "modes keep loading".
  const prev = getUser();
  if (prev) {
    persistUser({ ...prev, activeMode: key });
  }
  try {
    const res = await fetchAuthed('/api/modes/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw Object.assign(new Error(data.error ?? 'could not switch mode'), {
        status: res.status,
        code: data.code,
      });
    }
    persistUser(data.user); // reconcile with the server's canonical user
    return data.user;
  } catch (err) {
    if (prev) {
      persistUser(prev); // revert the optimistic flip
    }
    throw err;
  }
}

// ── Family PIN ───────────────────────────────────────────────────────
// The PIN lives server-side (bcrypt); the client only ever sees the
// familyMode boolean. Enable hides explicit + arms the lock; disable needs
// the PIN (the server throttles wrong tries — the thrown error carries
// attemptsLeft / retryAfterSec / code for the form to surface).
export async function enableFamilyMode(pin) {
  const res = await fetchAuthed('/api/family/enable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.error ?? 'could not enable family mode'), {
      status: res.status,
      code: data.code,
    });
  }
  persistUser(data.user);
  return data.user;
}

export async function disableFamilyMode(pin) {
  const res = await fetchAuthed('/api/family/disable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.error ?? 'could not disable family mode'), {
      status: res.status,
      code: data.code,
      attemptsLeft: data.attemptsLeft,
      retryAfterSec: data.retryAfterSec,
    });
  }
  persistUser(data.user);
  return data.user;
}

export function logout() {
  // Grab the token before the local clear so the server can still revoke the
  // session; the UI returns to sign-in immediately either way.
  const headers = authHeaders();
  clearSession();
  return fetch(`${API_BASE}/api/auth/logout`, {
    method: 'POST',
    headers,
  }).catch(() => {
    /* best-effort */
  });
}

// A 401 from an authed call does NOT directly tear down the session — a
// transient or endpoint-specific 401 shouldn't sign you out. Instead it hands
// off to the authoritative session check: fetchMe() re-validates against the
// server and clearSession()s iff the session is truly gone (deleted user,
// revoked or expired token). De-duped so a burst of 401s = one check; only
// fires when we currently believe we're signed in. Clearing the session flips
// App's auth gate back to sign-in (replaces the web /auth redirect).
let revalidating = false;
function revalidateSession() {
  if (revalidating || !isSignedIn()) {
    return;
  }
  revalidating = true;
  fetchMe()
    .catch(() => {
      /* network blip — keep the session, re-check later */
    })
    .finally(() => {
      revalidating = false;
    });
}

function authHeaders(extra = {}) {
  const token = storage.getItem(TOKEN_KEY);
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}

// Prefix relative paths with the API origin and ride the Bearer token on
// every call. A 401 hands off to the session re-check above instead of
// failing silently.
//
// Every call now carries a deadline (server work is bounded at 10s upstream +
// function overhead, so a healthy response never needs longer): without one, a
// hung connection was a 60-second spinner ended only by Vercel's maxDuration.
// `deadlineMs` overrides; 0 disables. The exemptions are deliberate and narrow:
// - getTrack (playback hydration/recovery) passes 0 — a timeout there turns
//   slow-success into failure on the path that decides WHICH TRACK PLAYS, and
//   playback behaviour must not change as a side effect of this item.
// - Gemini talk and image uploads pass longer budgets; both legitimately
//   outlive 15s on a slow network.
// Manual controller rather than AbortSignal.timeout: Hermes doesn't ship the
// static, and the timer must be cleared on settle either way — an uncleared
// timer is the jest leaked-handle class.
const DEFAULT_DEADLINE_MS = 15000;

export function fetchAuthed(path, opts = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const { deadlineMs = DEFAULT_DEADLINE_MS, ...rest } = opts;
  let signal = rest.signal;
  let timer = null;
  if (!signal && deadlineMs > 0) {
    const ctrl = new AbortController();
    timer = setTimeout(() => ctrl.abort(), deadlineMs);
    signal = ctrl.signal;
  }
  return fetch(url, { ...rest, signal, headers: authHeaders(rest.headers) })
    .then(res => {
      if (res.status === 401) {
        revalidateSession();
      }
      return res;
    })
    .finally(() => {
      if (timer) {
        clearTimeout(timer);
      }
    });
}
