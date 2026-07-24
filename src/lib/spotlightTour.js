// Generic spotlight tour — a tap-through walkthrough (next / back / skip) that
// highlights one element per step with a plain-copy card. Unlike the player's
// gesture tour (lib/gestureTour, which waits for the real gesture to be
// performed), these steps advance on a tap, so one engine drives Home,
// Settings, or any screen. A tour is { id, steps: [{ target, title, body }] } —
// `target` keys into the host screen's measured rect map, or is null for a
// centered step (welcome / done). Any exit — finished or skipped — marks the
// tour seen, so it auto-shows only once per device (replay ignores that).
import { storage } from '../storage/mmkv';

const seenKey = id => `aura.${id}TourDone`;

let state = { active: false, id: null, steps: [], step: 0 };
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

export function tourSeen(id) {
  return storage.getItem(seenKey(id)) === '1';
}

export function startTour(def) {
  if (!def?.steps?.length) {
    return;
  }
  state = { active: true, id: def.id, steps: def.steps, step: 0 };
  emit();
}

// Any way out marks the tour seen and clears state.
function finish() {
  if (state.id) {
    storage.setItem(seenKey(state.id), '1');
  }
  state = { active: false, id: null, steps: [], step: 0 };
  emit();
}

// Skip the whole tour — over for good, quietly.
export function endTour() {
  if (state.active) {
    finish();
  }
}

export function nextStep() {
  if (!state.active) {
    return;
  }
  if (state.step + 1 >= state.steps.length) {
    finish();
  } else {
    state = { ...state, step: state.step + 1 };
    emit();
  }
}

export function backStep() {
  if (!state.active || state.step === 0) {
    return;
  }
  state = { ...state, step: state.step - 1 };
  emit();
}
