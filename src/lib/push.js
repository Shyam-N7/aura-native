// FCM push — the client half. The shape of it:
// - Permission is asked AFTER the first real play (a humane moment: music is
//   audibly working, not a cold dialog at boot), once ever. A denial is
//   respected and never re-asked in-app — the OS settings own it from there.
// - The token registers on grant, on every refresh, and once per boot while
//   permission stands (keeps the server row fresh, heals lost registrations).
//   The server half lands separately — a 404 from /api/push/register simply
//   means it isn't deployed yet, and registration retries next boot.
// - A push arriving in the FOREGROUND is posted to the system shade by the
//   AuraNotifier module. FCM only draws a notification payload itself while the
//   app is backgrounded or dead; in the foreground it hands the message to JS,
//   so without this a broadcast reached nothing but a three-second toast. The
//   in-app quiet panel is for presence and resume offers, not for anything the
//   phone's own notification panel should be showing.
// - A tapped notification carries data.link (an aurafm.live URL) and routes
//   through the SAME handler as share links — push and deep links behave
//   identically by construction. The posted notification's tap intent is an
//   ACTION_VIEW on that link, so it re-enters through Linking exactly as a
//   shared link does.
import {
  AuthorizationStatus,
  deleteToken,
  getInitialNotification,
  getMessaging,
  getToken,
  hasPermission,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  requestPermission,
} from '@react-native-firebase/messaging';
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { storage } from '../storage/mmkv';
import { fetchAuthed, getUser } from './auth';
import { report } from './crumbs';
import { onSessionReset } from './sessionReset';
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
    // A 404 is the server half simply not being deployed — the next boot
    // retries and that is the designed behaviour, not a failure to report.
    // Anything else means this device is enrolled nowhere and will never be
    // reached, which nothing else in the app would ever tell us.
    if (!res.ok && res.status !== 404) {
      console.warn('[push] register failed', res.status);
      report(new Error(`push register failed (${res.status})`), 'push.register-failed', {
        status: res.status,
      });
    }
  } catch (err) {
    console.warn('[push] register failed', err?.message ?? err);
    report(err, 'push.register-failed');
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

// Put a message in the phone's notification panel.
//
// Used for the two deliveries the OS will NOT draw on its own: a push that
// arrives while the app is in the foreground, and a data-only payload in the
// background handler. Reads `notification` first and falls back to `data`, so
// it works whichever way the sender composed the message.
//
// Returns whether the system accepted it. The toast fallback covers a binary
// built before the native module existed and the case where notifications are
// switched off at the OS level — losing the message entirely is the one
// outcome worth avoiding.
export async function displayPush(msg, { fallbackToast = true } = {}) {
  const n = msg?.notification;
  const data = msg?.data ?? {};
  const title = n?.title ?? data.title ?? null;
  const body = n?.body ?? data.body ?? null;
  if (!title && !body) {
    return false;
  }
  try {
    const link = data.link ? String(data.link) : null;
    const shown = await NativeModules.AuraNotifier?.display?.(
      title,
      body,
      link,
    );
    if (shown) {
      return true;
    }
  } catch (err) {
    report(err, 'push.display-failed');
  }
  if (fallbackToast) {
    showToast(title ?? body);
  }
  return false;
}

// Wired once from the signed-in shell. Returns the unsubscribe bundle.
export function initPush() {
  const m = getMessaging();
  const subs = [
    onTokenRefresh(m, () => {
      registerToken();
    }),
    onMessage(m, async msg => {
      await displayPush(msg);
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

// Signing out has to surrender the push token, or the device keeps receiving
// the previous account's notifications: nothing in the client ever released it
// and there is no server-side unregister endpoint to call. Deleting it here
// makes the old registration undeliverable immediately; the next sign-in mints
// a fresh token, which initPush registers on its first boot with permission.
//
// Guarded on signedOut: this same reset runs when an account is REPLACED, and
// deleting mid-sign-in would race the registration that follows it — the
// device would end up enrolled under a token it no longer holds.
onSessionReset(({ signedOut }) => {
  if (!signedOut) {
    return;
  }
  deleteToken(getMessaging()).catch(err => report(err, 'push.token-delete'));
});

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
