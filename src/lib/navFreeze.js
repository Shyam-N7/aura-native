// Freeze window for the glass backdrops around navigation transitions.
// BlurView re-captures the whole view tree every frame; doing that DURING a
// stack pop interfered with the transition (the outgoing screen froze in
// place while the incoming one wiped over it — the owner's exit glitch).
// While frozen the pills keep their last snapshot — imperceptible for the
// ~half second a transition runs, and CSS backdrop-filter never redraws
// ancestors mid-transition either. Module bus, same idiom as scrollDepth.
const subs = new Set();
let frozen = false;
let timer = null;

// Native-stack slide runs ~350-400ms after the JS state commit; 550ms covers
// the bridge latency on both ends plus settle.
const FREEZE_MS = 550;

export function freezeGlass() {
  if (!frozen) {
    frozen = true;
    subs.forEach(fn => fn(true));
  }
  clearTimeout(timer);
  timer = setTimeout(() => {
    frozen = false;
    subs.forEach(fn => fn(false));
  }, FREEZE_MS);
}

export function subscribeGlassFreeze(fn) {
  subs.add(fn);
  fn(frozen);
  return () => subs.delete(fn);
}
