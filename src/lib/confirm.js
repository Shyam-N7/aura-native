// Event bus for the house confirm sheet — replaces the OS Alert dialog (the
// gray system popup read as foreign against the app's glass language). Same
// bus model as trackActionsSheet: confirm() publishes a request, the single
// ConfirmSheet instance in App renders it and resolves the promise.
//
//   if (await confirm({ title: 'sign out?', body: '…', action: 'sign out' }))
//
// Resolves true on the action, false on cancel / backdrop / back button. A
// new confirm while one is open supersedes it (the older resolves false) —
// two questions at once is always a bug upstream.
const subscribers = new Set();
let pending = null;

// `danger` paints the action pill red. It defaults to FALSE — red is the one
// cue this app uses for "this destroys something", so it has to be asked for.
// It used to default to TRUE here while ConfirmPopup's identical card
// defaulted to false, which is how questions like "Make this only you?" ended
// up wearing a destructive red they never requested; every call site now says
// which it is.
//
// `instant` is for the one kind of caller whose action tears down the tree the
// sheet lives in (sign out swaps the whole navigator for the sign-in screen).
// reanimated 4.2.3/Fabric aborts natively when a view is removed mid-exiting,
// so that sheet has to pop instead of slide. Everything else keeps the motion.
export function confirm({ title, body, action, danger = false, instant = false }) {
  return new Promise(resolve => {
    pending?.resolve(false);
    pending = { title, body, action, danger, instant, resolve };
    subscribers.forEach(fn => fn(pending));
  });
}

export function resolveConfirm(ok) {
  pending?.resolve(ok);
  pending = null;
  subscribers.forEach(fn => fn(null));
}

export function subscribeConfirm(fn) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
