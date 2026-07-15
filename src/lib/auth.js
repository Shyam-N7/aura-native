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
  storage.setItem(USER_KEY, JSON.stringify(user));
  if (user.hasOnboarded !== undefined) {
    storage.setItem('aura.hasOnboarded', user.hasOnboarded ? '1' : '');
  }
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
    'aura.hasOnboarded',
    'aura.seedArtists',
    'aura.seedLanguages',
    'aura.seedMood',
    'aura.queue',
    'aura.position',
    'aura.talkHistory',
    'aura.recentSearches',
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
  const data = await res.json();
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
export function fetchAuthed(path, opts = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  return fetch(url, { ...opts, headers: authHeaders(opts.headers) }).then(
    res => {
      if (res.status === 401) {
        revalidateSession();
      }
      return res;
    },
  );
}
