import { NativeModules } from 'react-native';
import { displayPush } from '../src/lib/push';
import { showToast } from '../src/lib/toast';

jest.mock('../src/lib/auth', () => ({
  fetchAuthed: jest.fn(async () => ({ ok: true, status: 200 })),
  getUser: jest.fn(() => ({ id: 'u1' })),
}));
jest.mock('../src/lib/toast', () => ({ showToast: jest.fn() }));
jest.mock('../src/lib/crumbs', () => ({ report: jest.fn() }));

const display = jest.fn(async () => true);

beforeEach(() => {
  jest.clearAllMocks();
  display.mockResolvedValue(true);
  NativeModules.AuraNotifier = { display };
});

afterEach(() => {
  delete NativeModules.AuraNotifier;
});

// The bug this pins: FCM draws a notification payload itself ONLY while the app
// is backgrounded or dead. In the foreground it hands the message to JS, and
// the foreground handler used to do nothing but raise an in-app toast — so an
// admin broadcast sent to a user with AURA open never reached the phone's
// notification panel at all.
test('a foreground push is posted to the system shade, not just toasted', async () => {
  const ok = await displayPush({
    notification: { title: 'new mix', body: 'tonight’s set is up' },
    data: { link: 'https://www.aurafm.live/p/abc' },
  });

  expect(ok).toBe(true);
  expect(display).toHaveBeenCalledWith(
    'new mix',
    'tonight’s set is up',
    'https://www.aurafm.live/p/abc',
  );
  // The toast is a fallback, not the delivery.
  expect(showToast).not.toHaveBeenCalled();
});

// Data-only payloads carry no `notification` block, so the OS draws nothing for
// them in the background either — the sender's fields live under `data`.
test('a data-only push still finds its title, body and link', async () => {
  await displayPush({
    data: { title: 'back online', body: 'picking up where you left off' },
  });

  expect(display).toHaveBeenCalledWith(
    'back online',
    'picking up where you left off',
    null,
  );
});

test('an empty push posts nothing', async () => {
  const ok = await displayPush({ data: {} });

  expect(ok).toBe(false);
  expect(display).not.toHaveBeenCalled();
  expect(showToast).not.toHaveBeenCalled();
});

// Notifications switched off at the OS level: the module reports the refusal
// rather than pretending, and the message still reaches the user somehow.
test('a refused post falls back to the toast', async () => {
  display.mockResolvedValue(false);

  const ok = await displayPush({ notification: { title: 'hello' } });

  expect(ok).toBe(false);
  expect(showToast).toHaveBeenCalledWith('hello');
});

// A binary built before the native module shipped has no AuraNotifier at all.
test('a missing native module falls back instead of throwing', async () => {
  delete NativeModules.AuraNotifier;

  await expect(
    displayPush({ notification: { title: 'hello', body: 'there' } }),
  ).resolves.toBe(false);
  expect(showToast).toHaveBeenCalledWith('hello');
});

// The background handler passes fallbackToast:false — there is no UI to show
// one to, and a queued toast would surface later out of context.
test('the background caller can opt out of the toast', async () => {
  display.mockResolvedValue(false);

  await displayPush(
    { data: { title: 'silent' } },
    { fallbackToast: false },
  );

  expect(showToast).not.toHaveBeenCalled();
});
