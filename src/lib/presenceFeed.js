// Cross-device presence as app state, not events (the quiet-panel decision:
// "nothing visits you — you visit it"). PresenceAgent runs the heartbeat/poll
// hooks app-wide and publishes here; the home now-playing card is the single
// surface that renders it. Same module-bus idiom as scrollDepth.
let state = { elsewhere: null, resume: null, acceptResume: null, dismissResume: null };
const subs = new Set();

export function setPresenceFeed(next) {
  state = next;
  subs.forEach(fn => fn(state));
}

export function subscribePresenceFeed(fn) {
  subs.add(fn);
  fn(state);
  return () => subs.delete(fn);
}
