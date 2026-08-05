import { deleteToken } from '@react-native-firebase/messaging';
import { storage } from '../src/storage/mmkv';
import { resetSessionState } from '../src/lib/sessionReset';
import { clearSession } from '../src/lib/auth';
import { pushRecentSearch } from '../src/hooks/useRecentSearches';
import { addTalkMessage } from '../src/hooks/useTalkHistory';
import { homeCache } from '../src/lib/homeCache';
import { logImpressions } from '../src/api/impressions';
import {
  isPrivateSession,
  setPrivateSession,
  subscribePrivateSession,
} from '../src/lib/privateSession';
import { fetchAuthed } from '../src/lib/auth';
// Side-effect import: push registers its token teardown at module scope, the
// same way App.jsx pulls it in. A store that is never imported never registers
// — which is why App.jsx imports the session-scoped stores explicitly.
import '../src/lib/push';

jest.mock('../src/lib/auth', () => {
  const actual = jest.requireActual('../src/lib/auth');
  return { ...actual, fetchAuthed: jest.fn(async () => ({ ok: true })) };
});

// What signing out actually does, in order: clearSession() removes the
// persisted keys, notifies auth, and the shell's subscriber fires the registry.
// Module stores that re-read storage must therefore come back empty.
const signOut = () => {
  clearSession();
  resetSessionState({ signedOut: true });
};

beforeEach(() => {
  for (const k of Object.keys(homeCache)) {
    delete homeCache[k];
  }
  storage.removeItem('aura.recentSearches');
  storage.removeItem('aura.talkHistory');
  storage.removeItem('aura.privateUntil');
  // Drain module state from the previous case FIRST — this reset is setup, not
  // the thing under test, so its own calls must not be counted.
  resetSessionState({ signedOut: true });
  jest.clearAllMocks();
});

// The leak: `items` is read once at import. clearSession wiped the DISK key,
// but the module array kept user A's queries — the next user saw them on the
// Search screen, and the first search they committed wrote A's list back under
// their own account.
test('recent searches do not survive into the next account', () => {
  pushRecentSearch('anirudh');
  pushRecentSearch('marandhu poche');
  expect(JSON.parse(storage.getItem('aura.recentSearches'))).toHaveLength(2);

  signOut();
  pushRecentSearch('ilaiyaraaja');

  // Only the new account's query — if the module array had survived, A's two
  // would have been persisted alongside it.
  expect(JSON.parse(storage.getItem('aura.recentSearches'))).toEqual([
    'ilaiyaraaja',
  ]);
});

// The leak: up to 50 messages of one account's conversation with AURA seeded
// the next account's Talk screen. The file's own comment claimed clearSession
// handled it; clearSession only ever touched the disk.
test('talk history does not survive into the next account', () => {
  addTalkMessage({ role: 'user', text: 'something personal' });
  expect(JSON.parse(storage.getItem('aura.talkHistory'))).toHaveLength(1);

  signOut();
  addTalkMessage({ role: 'user', text: 'hello' });

  const stored = JSON.parse(storage.getItem('aura.talkHistory'));
  expect(stored).toHaveLength(1);
  expect(stored[0].text).toBe('hello');
});

// The leak: useHomeSection treats a populated key as a reason to SKIP the
// fetch, so a carried-over cache both showed the previous user's Home and
// suppressed the request that would have corrected it.
test('the home cache does not survive into the next account', () => {
  homeCache.quickPicks = [{ id: 't1' }];
  homeCache.reco = { hero: 'a' };

  signOut();

  expect(homeCache.quickPicks).toBeUndefined();
  expect(homeCache.reco).toBeUndefined();
});

// The leak: the guard key is (surface, day) with no account in it, so the new
// user's first Home visit counted as already logged.
test('the impression guard does not survive into the next account', () => {
  logImpressions('quick-picks', ['t1']);
  expect(fetchAuthed).toHaveBeenCalledTimes(1);

  // Same surface, same day — correctly suppressed within one session.
  logImpressions('quick-picks', ['t2']);
  expect(fetchAuthed).toHaveBeenCalledTimes(1);

  signOut();
  logImpressions('quick-picks', ['t3']);
  expect(fetchAuthed).toHaveBeenCalledTimes(2);
});

// The leak: a wall-clock deadline that was never in clearSession's key list.
// Signing out ten minutes into a 6-hour window left the NEXT account's
// listening untracked for the rest of it, with nothing in their UI saying so.
test('a private session does not survive into the next account', () => {
  setPrivateSession(true);
  expect(isPrivateSession()).toBe(true);

  const seen = [];
  const unsub = subscribePrivateSession(v => seen.push(v));

  signOut();

  expect(isPrivateSession()).toBe(false);
  // Any mounted toggle repaints rather than sitting on a stale "on".
  expect(seen).toContain(false);
  unsub();
});

// The leak: nothing in the client ever released the token, and there is no
// server-side unregister endpoint — so the device kept receiving the
// signed-out account's notifications.
test('signing out surrenders the push token', () => {
  resetSessionState({ signedOut: true });
  expect(deleteToken).toHaveBeenCalledTimes(1);
});

// ...but replacing an account must NOT: deleting mid-sign-in races the
// registration that follows and leaves the device enrolled under a token it no
// longer holds.
test('switching accounts does not delete the push token', () => {
  resetSessionState({ signedOut: false });
  expect(deleteToken).not.toHaveBeenCalled();
});

// A half-reset session is the precise condition the registry exists to stop.
test('one failing reset does not strand the others', () => {
  const { onSessionReset } = require('../src/lib/sessionReset');
  const after = jest.fn();
  const unsubA = onSessionReset(() => {
    throw new Error('boom');
  });
  const unsubB = onSessionReset(after);

  homeCache.quickPicks = [{ id: 't1' }];
  expect(() => resetSessionState({ signedOut: true })).not.toThrow();

  expect(after).toHaveBeenCalled();
  expect(homeCache.quickPicks).toBeUndefined();
  unsubA();
  unsubB();
});
