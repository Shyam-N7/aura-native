// Generic spotlight tour — a SELF-DRIVING walkthrough. It opens what it needs
// to show, spotlights one element per step, and moves on by itself; the
// controls (back / next / skip) are an override, not the way through. Unlike
// the player's gesture tour (lib/gestureTour, which waits for the real gesture
// to be performed), nothing here needs the user's hand, so one engine drives
// Home, Settings, or any screen.
//
// A tour is { id, steps: [{ target, title, body, open?, dwell? }] } — `target`
// keys into the host screen's measured rect map, or is null for a centered
// step (welcome / done). Any exit — finished or skipped — marks the tour seen,
// so it auto-shows only once per device (replay ignores that).
import { storage } from '../storage/mmkv';

const seenKey = id => `aura.${id}TourDone`;

// How long a step holds before the tour moves on. Reading time scales with the
// copy (~24 chars/sec, the pace of a glance, not a read-aloud), floored so
// short lines don't flash past and capped so nothing overstays.
const DWELL_MIN = 2600;
const DWELL_MAX = 6400;
const MS_PER_CHAR = 42;

export function stepDwell(step) {
  if (!step) {
    return DWELL_MIN;
  }
  if (typeof step.dwell === 'number') {
    return step.dwell;
  }
  const chars = `${step.title ?? ''} ${step.body ?? ''}`.trim().length;
  return Math.min(DWELL_MAX, Math.max(DWELL_MIN, 900 + chars * MS_PER_CHAR));
}

let state = { active: false, id: null, steps: [], step: 0, paused: false };
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
  state = {
    active: true,
    id: def.id,
    steps: def.steps,
    step: 0,
    paused: false,
  };
  emit();
}

// Any way out marks the tour seen and clears state.
function finish() {
  if (state.id) {
    storage.setItem(seenKey(state.id), '1');
  }
  state = { active: false, id: null, steps: [], step: 0, paused: false };
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
  // Stepping back is a deliberate "wait, show me that again" — hold there
  // instead of auto-advancing off it a beat later.
  state = { ...state, step: state.step - 1, paused: true };
  emit();
}

// Pause/resume the self-driving clock (the card's hold button).
export function toggleTourPause() {
  if (!state.active) {
    return;
  }
  state = { ...state, paused: !state.paused };
  emit();
}
