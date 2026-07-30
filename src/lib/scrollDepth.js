// How the dock knows the active screen is scrolled deep (web: MobileDock's
// mode='backtotop'). Screens with long scrollers report a boolean depth signal
// plus their own way back up; the dock subscribes and liquid-contracts into
// the "take me back up" pill. Module-scope singleton, same shape as
// useRecentSearches' store — one producer (the focused screen), one consumer.
let state = { deep: false, toTop: null };
const subs = new Set();

export function setScrollDepth(deep, toTop) {
  state = { deep, toTop: toTop ?? state.toTop };
  subs.forEach(fn => fn(state));
}

// Screens call this on blur/unmount so a deep flag never outlives its screen
// (the dock would contract over a screen that was never scrolled).
export function clearScrollDepth() {
  if (state.deep || state.toTop) {
    state = { deep: false, toTop: null };
    subs.forEach(fn => fn(state));
  }
}

export function subscribeScrollDepth(fn) {
  subs.add(fn);
  fn(state);
  return () => subs.delete(fn);
}
