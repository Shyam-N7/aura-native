// Singleton sleep timer, ported from web src/lib/sleepTimer.js: pause
// playback after a duration or when the current set finishes. Deliberately
// NOT persisted — an app restart disarms. Entirely client-side.
//
// The deadline is wall-clock (endsAt) checked from two directions: a 1s
// interval (foreground) and PlayerContext's onProgress events (RNTP emits
// them every second while playing, screen off included — the case a sleep
// timer exists for). Whichever sees the deadline first fires; firing clears
// state so the other can't double-fire.

let timer = null; // { mode:'duration', endsAt, totalMs } | { mode:'end-of-set' }
let interval = null;
const subs = new Set();
const fireSubs = new Set();

function snapshot() {
  if (!timer) {
    return null;
  }
  if (timer.mode === 'end-of-set') {
    return { mode: 'end-of-set' };
  }
  return {
    mode: 'duration',
    totalMs: timer.totalMs,
    remainingMs: Math.max(0, timer.endsAt - Date.now()),
  };
}

function notify() {
  const s = snapshot();
  subs.forEach(fn => fn(s));
}

function clear() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  timer = null;
}

function fire(kind) {
  clear();
  notify();
  fireSubs.forEach(fn => fn(kind));
}

// start(ms) or start('end-of-set'); re-arming replaces the previous timer.
export function startSleepTimer(msOrEndOfSet) {
  clear();
  if (msOrEndOfSet === 'end-of-set') {
    timer = { mode: 'end-of-set' };
  } else {
    timer = {
      mode: 'duration',
      endsAt: Date.now() + msOrEndOfSet,
      totalMs: msOrEndOfSet,
    };
    interval = setInterval(tickSleepTimer, 1000);
  }
  notify();
}

export function cancelSleepTimer() {
  if (!timer) {
    return;
  }
  clear();
  notify();
}

export function tickSleepTimer() {
  if (timer?.mode !== 'duration') {
    return;
  }
  if (Date.now() >= timer.endsAt) {
    fire('duration');
  } else {
    notify();
  }
}

// The end-of-set trigger: called at the exact moment the queue would
// otherwise wrap or fall through to auto-radio — it preempts both.
export function fireEndOfSetIfArmed() {
  if (timer?.mode !== 'end-of-set') {
    return false;
  }
  fire('end-of-set');
  return true;
}

export function getSleepState() {
  return snapshot();
}

export function subscribeSleep(fn) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export function subscribeSleepFire(fn) {
  fireSubs.add(fn);
  return () => {
    fireSubs.delete(fn);
  };
}
