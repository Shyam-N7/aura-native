// FCM push — the client half. The shape of it:
// - Permission is asked AFTER the first real play (a humane moment: music is
//   audibly working, not a cold dialog at boot), once ever. A denial is
//   respected and never re-asked in-app — the OS settings own it from there.
// - The token registers on grant, on every refresh, and once per boot while
//   permission stands (keeps the server row fresh, heals lost registrations).
//   The server half lands separately — a 404 from /api/push/register simply
//   means it isn't deployed yet, and registration retries next boot.
// - A push arriving in the FOREGROUND becomes the house toast, never a
//   system banner over the open app.
// - A tapped notification carries data.link (an aurafm.live URL) and routes
//   through the SAME handler as share links — push and deep links behave
//   identically by construction.
import {
  AuthorizationStatus,
  getInitialNotification,
  getMessaging,
  getToken,
  hasPermission,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  requestPermission,
} from '@react-native-firebase/messaging';
import { PermissionsAndroid, Platform } from 'react-native';
import { storage } from '../storage/mmkv';
import { fetchAuthed, getUser } from './auth';
import { showToast } from './toast';

// .v2 — the v1 flag was burned by an ask that never happened (see
// askOsPermission), so every install that predates this has "already been
// asked" recorded against a dialog it was never shown. Bumping the key gives
// each of them the one real ask they're owed; the OS caps it from there.
const ASKED_KEY = 'aura.pushAsked.v2';

let linkHandler = null;
export function setPushLinkHandler(fn) {
  linkHandler = fn;
}

const granted = s =>
  s === AuthorizationStatus.AUTHORIZED || s === AuthorizationStatus.PROVISIONAL;

async function registerToken() {
  if (!getUser()) {
    return;
  }
  try {
    const token = await getToken(getMessaging());
    if (!token) {
      return;
    }
    const res = await fetchAuthed('/api/push/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!res.ok && res.status !== 404) {
      console.warn('[push] register failed', res.status);
    }
  } catch (err) {
    console.warn('[push] register failed', err?.message ?? err);
  }
}

// Ask the platform that actually owns the decision.
//
// Firebase's requestPermission is an iOS API. On Android it returns a
// hard-coded AUTHORIZED without showing anything (@react-native-firebase
// /messaging namespaced.js: `if (isAndroid) return AUTHORIZED`), and the
// Android native module has no requestPermission method at all. So the old
// code believed it had asked, registered a token, and left POST_NOTIFICATIONS
// denied-by-default on Android 13+ — tokens enrolled, nothing displayable.
// (hasPermission IS real on Android, which is why anyone who granted by hand
// in Settings still registers on the next boot via initPush.)
async function askOsPermission() {
  if (Platform.OS !== 'android') {
    return granted(await requestPermission(getMessaging()));
  }
  if (Platform.Version < 33) {
    return true; // pre-13: granted at install time
  }
  const res = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
  );
  return res === PermissionsAndroid.RESULTS.GRANTED;
}

// Called a beat into the first play — a humane moment, once ever.
export async function ensurePushPermission() {
  if (storage.getItem(ASKED_KEY) === '1') {
    return;
  }
  try {
    const ok = await askOsPermission();
    // Recorded only once a real answer came back. The flag used to be set
    // before the call, which was the right instinct against a nag loop but
    // spent the single ask on a dialog that never opened. A crash mid-dialog
    // now costs one more prompt on the next play, and Android itself stops
    // showing it after the user has said no twice.
    storage.setItem(ASKED_KEY, '1');
    if (ok) {
      await registerToken();
    }
  } catch (err) {
    console.warn('[push] permission ask failed', err?.message ?? err);
  }
}

const route = msg => {
  const link = msg?.data?.link;
  if (link && linkHandler) {
    linkHandler(String(link));
  }
};

// Wired once from the signed-in shell. Returns the unsubscribe bundle.
export function initPush() {
  const m = getMessaging();
  const subs = [
    onTokenRefresh(m, () => {
      registerToken();
    }),
    onMessage(m, async msg => {
      const n = msg?.notification;
      if (n?.title || n?.body) {
        showToast(n.title ?? n.body);
      }
    }),
    onNotificationOpenedApp(m, route),
  ];
  // Cold start from a notification tap — route once the shell is up.
  getInitialNotification(m)
    .then(msg => {
      if (msg) {
        route(msg);
      }
    })
    .catch(() => {});
  hasPermission(m)
    .then(s => {
      if (granted(s)) {
        registerToken();
      }
    })
    .catch(() => {});
  return () => subs.forEach(u => u());
}

// ── Notification preferences (settings switches) ─────────────────────
// Server-persisted — the sender checks the same row before every triggered
// push, so a switch flipped here silences that category on every device.
export async function getPushPrefs() {
  const res = await fetchAuthed('/api/push/prefs');
  if (!res.ok) {
    throw new Error(`prefs fetch failed (${res.status})`);
  }
  return res.json();
}

export async function setPushPrefs(prefs) {
  const res = await fetchAuthed('/api/push/prefs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error ?? 'update failed');
  }
  return data;
}

// ── Admin console (allow-listed emails only — the server re-checks) ──
export async function adminPushReach() {
  const res = await fetchAuthed('/api/admin/push/reach');
  if (!res.ok) {
    throw new Error(`reach fetch failed (${res.status})`);
  }
  return res.json();
}

export async function adminPushSend({ title, body, link, image, audience }) {
  const res = await fetchAuthed('/api/admin/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, link, image, audience }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error ?? 'send failed');
  }
  return data;
}
