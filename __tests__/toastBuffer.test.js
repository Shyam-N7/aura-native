import { showToast, subscribeToast } from '../src/lib/toast';
import { resetSessionState } from '../src/lib/sessionReset';

// The buffer exists so a toast fired in the sub-frame gap before the host
// mounts isn't dropped. It had no expiry, and playback runs headless — the
// engine and the service both toast with the UI unmounted. So a stall or a
// dead track while the app was swiped away replayed on the first frame of the
// NEXT launch, about a network that had long since come back.

const drain = () => subscribeToast(() => {})();

beforeEach(() => {
  jest.useRealTimers();
  drain();
});
afterEach(() => drain());

test('a toast fired just before the host mounts still arrives', () => {
  showToast('added to your queue.');

  const seen = [];
  const off = subscribeToast(e => seen.push(e.message));

  expect(seen).toEqual(['added to your queue.']);
  off();
});

test('a stale one is dropped instead of replaying next launch', () => {
  showToast("couldn't play this track — skipping.");

  // An hour later, the app is reopened and the Toast host mounts.
  const realNow = Date.now;
  Date.now = () => realNow() + 60 * 60 * 1000;
  const seen = [];
  const off = subscribeToast(e => seen.push(e.message));
  Date.now = realNow;

  expect(seen).toEqual([]);
  off();
});

test('a dropped message is not kept for the subscriber after it', () => {
  showToast('old news.');

  const realNow = Date.now;
  Date.now = () => realNow() + 60 * 60 * 1000;
  subscribeToast(() => {})();
  Date.now = realNow;

  const seen = [];
  const off = subscribeToast(e => seen.push(e.message));
  expect(seen).toEqual([]);
  off();
});

// Buffered toasts are one account's, like every other module-scope store.
test('sign-out clears a buffered toast', () => {
  showToast('your connection dropped — waiting for it to come back.');

  resetSessionState({ signedOut: true });

  const seen = [];
  const off = subscribeToast(e => seen.push(e.message));
  expect(seen).toEqual([]);
  off();
});
