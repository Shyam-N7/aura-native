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
import { storage } from '../storage/mmkv';
import { fetchAuthed, getUser } from './auth';
import { showToast } from './toast';

const ASKED_KEY = 'aura.pushAsked';

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

// Called a beat into the first play. Once ever: the asked flag is set BEFORE
// the dialog so a crash mid-dialog can't turn into a nag loop.
export async function ensurePushPermission() {
  if (storage.getItem(ASKED_KEY) === '1') {
    return;
  }
  storage.setItem(ASKED_KEY, '1');
  try {
    const status = await requestPermission(getMessaging());
    if (granted(status)) {
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
