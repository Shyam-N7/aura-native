// First-run gesture tour — do-it-live. One card at a time over the LIVE
// player, and each step waits for its real gesture to be performed there:
// exposure alone teaches nothing, the hand has to do it once (the same
// philosophy as lib/hints, which keeps teaching whatever the tour skips).
// Fully skippable per step and wholly; replayable from the player ⋯ menu.
// The tour never auto-shows twice: ANY way it ends (finished, skipped, or
// the player closed mid-tour) marks it done.
import { storage } from '../storage/mmkv';
import { showToast } from './toast';

const KEY = 'aura.gestureTourDone';

// Step ids double as the vocabulary the player's gesture handlers speak via
// noteTourGesture. how/what copy is shared with the ⋯ menu's gesture guide.
export const TOUR_STEPS = [
  { id: 'like', how: 'double-tap the art', what: 'like the song' },
  {
    id: 'swipe',
    how: 'swipe the art left or right',
    what: 'next song / previous song',
  },
  {
    id: 'hold',
    how: 'hold the art near an edge',
    what: 'right fast-forwards, left rewinds',
  },
  { id: 'queue', how: 'swipe up over "up next"', what: 'open the queue' },
  { id: 'close', how: 'drag down from the top', what: 'close the player' },
];

let state = { active: false, step: 0 };
const subs = new Set();

function emit() {
  for (const cb of subs) {
    cb(state);
  }
}

export function getTourState() {
  return state;
}

export function subscribeTour(cb) {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function tourDone() {
  return storage.getItem(KEY) === '1';
}

export function startTour() {
  state = { active: true, step: 0 };
  emit();
}

// Skip-all / player-closed-mid-tour: over for good, quietly.
export function endTour() {
  if (!state.active) {
    return;
  }
  storage.setItem(KEY, '1');
  state = { active: false, step: 0 };
  emit();
}

function advance() {
  if (state.step + 1 >= TOUR_STEPS.length) {
    // Reached the end — done for good, with a send-off.
    storage.setItem(KEY, '1');
    state = { active: false, step: 0 };
    emit();
    showToast("that's the tour. enjoy.", { tick: true });
  } else {
    state = { active: true, step: state.step + 1 };
    emit();
  }
}

export function skipTourStep() {
  if (state.active) {
    advance();
  }
}

// Called by the player's gesture handlers the moment a gesture lands.
// Returns true when the tour consumed it (it was the awaited step).
export function noteTourGesture(id) {
  if (!state.active || TOUR_STEPS[state.step]?.id !== id) {
    return false;
  }
  advance();
  return true;
}
