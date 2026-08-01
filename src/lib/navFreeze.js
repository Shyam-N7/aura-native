// Freeze window for the glass backdrops around navigation transitions.
// BlurView re-captures the whole view tree every frame; doing that DURING a
// stack pop interfered with the transition (the outgoing screen froze in
// place while the incoming one wiped over it — the owner's exit glitch).
// While frozen the pills keep their last snapshot — imperceptible for the
// ~half second a transition runs, and CSS backdrop-filter never redraws
// ancestors mid-transition either. Module bus, same idiom as scrollDepth.
const subs = new Set();
const holds = new Set();
let timerFrozen = false;
let timer = null;
let emitted = false;

// Native-stack slide runs ~350-400ms after the JS state commit; 550ms covers
// the bridge latency on both ends plus settle.
const FREEZE_MS = 550;

function emit() {
  const now = timerFrozen || holds.size > 0;
  if (now !== emitted) {
    emitted = now;
    subs.forEach(fn => fn(now));
  }
}

export function freezeGlass() {
  timerFrozen = true;
  emit();
  clearTimeout(timer);
  timer = setTimeout(() => {
    timerFrozen = false;
    emit();
  }, FREEZE_MS);
}

// Held freeze for full-screen overlays (the player sheet): occlusion is not
// clipping, so the capture guard can't tell the pills are covered — without
// the hold they keep software-drawing the whole tree (sheet included) on
// every animated frame, for glass nobody can see. Keyed so several holders
// can overlap without releasing each other.
export function holdGlassFrozen(key, on) {
  if (on) {
    holds.add(key);
  } else {
    holds.delete(key);
  }
  emit();
}

export function subscribeGlassFreeze(fn) {
  subs.add(fn);
  fn(emitted);
  return () => subs.delete(fn);
}
