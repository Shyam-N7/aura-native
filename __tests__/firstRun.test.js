import { storage } from '../src/storage/mmkv';
import { resetSessionState } from '../src/lib/sessionReset';
import {
  WHATS_NEW_BATCH,
  closeWhatsNew,
  markWhatsNewSeenForNewInstall,
  shouldShowWhatsNew,
} from '../src/lib/whatsNew';
import {
  endTour,
  getTourState,
  startTour,
  tourDone,
} from '../src/lib/gestureTour';

// First-run taught the same two gestures three times: a "what's new / fresh in
// this update" sheet auto-opened on a BRAND-NEW install, then the hint chips
// and the do-it-live tour rendered in the player with neither gating on the
// other. Decision: keep the tour, suppress the other two.

const KEY = 'aura.whatsNewSeen';
const DONE = 'aura.gestureTourDone';

beforeEach(() => {
  storage.removeItem(KEY);
  storage.removeItem(DONE);
  endTour();
  storage.removeItem(DONE); // endTour writes it
});

test('a fresh install does not get the what’s-new sheet', () => {
  // The unset key read as "unseen", so the sheet announced what was fresh in
  // an update to someone who had installed the app minutes earlier.
  expect(shouldShowWhatsNew()).toBe(true);

  markWhatsNewSeenForNewInstall(); // what finishing onboarding now does

  expect(shouldShowWhatsNew()).toBe(false);
});

test('an existing install still gets it when a new batch ships', () => {
  storage.setItem(KEY, 'an-older-batch');

  // Not a fresh install — this must not silently mark the new batch seen.
  markWhatsNewSeenForNewInstall();

  expect(storage.getItem(KEY)).toBe('an-older-batch');
  expect(shouldShowWhatsNew()).toBe(true);
});

test('closing it normally still records the current batch', () => {
  closeWhatsNew();
  expect(storage.getItem(KEY)).toBe(WHATS_NEW_BATCH);
  expect(shouldShowWhatsNew()).toBe(false);
});

// The live tour POSITION is per-account; the done flag is per-device.
test('an account change resets the tour position but not the done flag', () => {
  startTour();
  expect(getTourState().active).toBe(true);
  storage.setItem(DONE, '1');

  resetSessionState({ signedOut: true });

  // The next account must not arrive mid-tour at "try it - 4 of 5" with the
  // earlier steps never shown.
  expect(getTourState()).toEqual({ active: false, step: 0 });
  // ...but whoever holds this phone has already learnt the gestures.
  expect(tourDone()).toBe(true);
});
