import { storage } from '../src/storage/mmkv';
import { showToast } from '../src/lib/toast';
import {
  TOUR_STEPS,
  endTour,
  getTourState,
  noteTourGesture,
  skipTourStep,
  startTour,
  subscribeTour,
  tourDone,
} from '../src/lib/gestureTour';

jest.mock('../src/lib/toast', () => ({ showToast: jest.fn() }));

beforeEach(() => {
  // endTour first (it writes the done flag when a tour is active), THEN wipe.
  endTour();
  storage.removeItem('aura.gestureTourDone');
  jest.clearAllMocks();
});

test('every step teaches one gesture in plain words', () => {
  expect(TOUR_STEPS).toHaveLength(5);
  for (const step of TOUR_STEPS) {
    expect(step.id).toBeTruthy();
    expect(step.how).toBeTruthy();
    expect(step.what).toBeTruthy();
  }
});

test('only the awaited gesture advances a step', () => {
  startTour();
  expect(getTourState()).toEqual({ active: true, step: 0 });

  // Step 0 waits for the double-tap — a queue swipe is not consumed.
  expect(noteTourGesture('queue')).toBe(false);
  expect(getTourState().step).toBe(0);

  expect(noteTourGesture('like')).toBe(true);
  expect(getTourState()).toEqual({ active: true, step: 1 });
});

test('finishing the last step ends the tour for good, with a send-off', () => {
  const seen = [];
  const unsub = subscribeTour(s => seen.push(s));
  startTour();
  skipTourStep(); // past like
  skipTourStep(); // past swipe
  skipTourStep(); // past hold
  skipTourStep(); // past queue
  expect(getTourState().step).toBe(4);

  expect(noteTourGesture('close')).toBe(true);
  expect(getTourState().active).toBe(false);
  expect(tourDone()).toBe(true);
  expect(showToast).toHaveBeenCalledWith("That's the tour. Enjoy.", {
    tick: true,
  });
  expect(seen.length).toBeGreaterThan(0);
  unsub();

  // Done means done — gestures land as normal gestures now.
  expect(noteTourGesture('like')).toBe(false);
});

test('skipping the whole tour ends it quietly and never re-nags', () => {
  startTour();
  endTour();
  expect(getTourState().active).toBe(false);
  expect(tourDone()).toBe(true);
  expect(showToast).not.toHaveBeenCalled();

  // Ending an inactive tour never writes anything.
  storage.removeItem('aura.gestureTourDone');
  endTour();
  expect(tourDone()).toBe(false);
});
