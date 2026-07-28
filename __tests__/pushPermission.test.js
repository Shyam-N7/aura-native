import { PermissionsAndroid, Platform } from 'react-native';
import { requestPermission } from '@react-native-firebase/messaging';
import { ensurePushPermission } from '../src/lib/push';
import { fetchAuthed } from '../src/lib/auth';
import { storage } from '../src/storage/mmkv';

// registerToken needs a signed-in user and a server that accepts the token.
jest.mock('../src/lib/auth', () => ({
  fetchAuthed: jest.fn(async () => ({ ok: true, status: 200 })),
  getUser: jest.fn(() => ({ id: 'u1' })),
}));

const ASKED_KEY = 'aura.pushAsked.v2';

const onAndroid = (version = 33) => {
  Object.defineProperty(Platform, 'OS', {
    get: () => 'android',
    configurable: true,
  });
  Object.defineProperty(Platform, 'Version', {
    get: () => version,
    configurable: true,
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  storage.removeItem(ASKED_KEY);
  onAndroid();
});

// The bug this pins: Firebase's requestPermission is an iOS API that returns
// a hard-coded AUTHORIZED on Android without showing anything. Asking it and
// believing the answer left POST_NOTIFICATIONS denied while we registered a
// token — enrolled devices that could never display a push.
test('android 13+ asks the OS, never firebase, and registers on grant', async () => {
  const ask = jest
    .spyOn(PermissionsAndroid, 'request')
    .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);

  await ensurePushPermission();

  expect(ask).toHaveBeenCalledWith(
    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
  );
  expect(requestPermission).not.toHaveBeenCalled();
  expect(fetchAuthed).toHaveBeenCalledWith(
    '/api/push/register',
    expect.objectContaining({ method: 'POST' }),
  );
});

test('a denial registers nothing, and the ask is never repeated', async () => {
  const ask = jest
    .spyOn(PermissionsAndroid, 'request')
    .mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);

  await ensurePushPermission();
  expect(fetchAuthed).not.toHaveBeenCalled();

  await ensurePushPermission();
  expect(ask).toHaveBeenCalledTimes(1);
});

test('below android 13 the permission ships granted — no prompt, still registers', async () => {
  onAndroid(32);
  const ask = jest.spyOn(PermissionsAndroid, 'request');

  await ensurePushPermission();

  expect(ask).not.toHaveBeenCalled();
  expect(fetchAuthed).toHaveBeenCalled();
});

// A throw must not burn the one ask the app ever takes.
test('a failed ask leaves the flag unset so the next play can retry', async () => {
  jest
    .spyOn(PermissionsAndroid, 'request')
    .mockRejectedValueOnce(new Error('activity gone'));

  await ensurePushPermission();
  expect(storage.getItem(ASKED_KEY)).toBeNull();

  jest
    .spyOn(PermissionsAndroid, 'request')
    .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
  await ensurePushPermission();
  expect(fetchAuthed).toHaveBeenCalled();
});
