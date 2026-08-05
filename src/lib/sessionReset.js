// Account-change teardown for state that lives in MODULE scope.
//
// clearSession() removes the persisted keys, but several stores mirror those
// keys into a module-level variable read once at import. Wiping the disk does
// nothing to the mirror: the next account inherits the previous one's data and,
// on its first write, persists it right back under the new owner. Recent
// searches and talk history both shipped exactly that way, and the shell only
// knew to reset the two stores someone had remembered to wire into it.
//
// So the registration lives with the store instead. A module that owns
// per-account state opts in at its own definition site, and cannot be
// forgotten by an unrelated edit to App.jsx.
//
// Ordering: the shell fires this from its auth subscriber, which runs AFTER
// clearSession() has removed the keys — so a store whose reset re-reads storage
// correctly comes back empty.
const resets = new Set();

/**
 * Register a reset. Called with `{ signedOut }` — true when the account is
 * going away rather than being replaced, which is the only moment some
 * teardown is safe (deleting the push token mid-sign-in would race the
 * registration that follows it).
 *
 * Returns an unsubscribe, though stores registered at module scope live for
 * the whole process and never need it.
 */
export function onSessionReset(fn) {
  resets.add(fn);
  return () => resets.delete(fn);
}

export function resetSessionState(context = {}) {
  resets.forEach(fn => {
    try {
      fn(context);
    } catch {
      // One store failing to reset must never strand the rest — a half-reset
      // session is the precise condition this module exists to prevent.
    }
  });
}

// Test-only: drop registrations between specs.
export function _resetSessionRegistry() {
  resets.clear();
}
