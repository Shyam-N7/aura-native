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

export function confirm({ title, body, action, danger = true }) {
  return new Promise(resolve => {
    pending?.resolve(false);
    pending = { title, body, action, danger, resolve };
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
