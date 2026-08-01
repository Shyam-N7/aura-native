import { useEffect, useState } from 'react';

// Shared search-morph state — the query text AND whether the floating top
// bar's field layer is open. Module-scope singleton, same shape as
// scrollDepth.js (one bus, no context): the top bar mounts once PER TAB
// (Home/Search/Talk/You each render their own TopBar instance), so this is
// what lets the tab you tapped search from, and the Search tab's own bar,
// agree on one open/query state — ported from the web's searchQuery.js store
// (which only needed the query; native also needs the open flag since there's
// no single persistent bar node to morph in place across screens).
let query = '';
let open = false;
// One-shot: an `instant` open presents the field with no morph animation —
// tab-entering Search replays no theatre (owner report: the bar flashed
// white mid-crossfade on every tab entry). The chip tap keeps the morph.
let instant = false;
const subs = new Set();

function emit() {
  const snap = { query, open, instant };
  subs.forEach(fn => fn(snap));
}

export function getSearchQuery() {
  return query;
}

export function setSearchQuery(v) {
  const next = v ?? '';
  if (next === query) return;
  query = next;
  emit();
}

// Idempotent — re-tapping the search chip while already open is a no-op,
// same guard as the web's openSearch. A chip-tap open that then lands on the
// Search tab keeps its animated morph: the focus listener's instant open
// no-ops against the already-open state.
export function openSearch(opts) {
  if (open) return;
  open = true;
  instant = !!opts?.instant;
  emit();
}

// An explicit close (‹, or leaving the Search tab) discards the query too —
// web parity (closeSearch clears the field on its way out).
export function closeSearch() {
  if (!open && query === '') return;
  open = false;
  query = '';
  instant = false;
  emit();
}

export function useSearchQuery() {
  const [snap, setSnap] = useState({ query, open, instant });
  useEffect(() => {
    subs.add(setSnap);
    return () => subs.delete(setSnap);
  }, []);
  return {
    query: snap.query,
    open: snap.open,
    instant: snap.instant,
    setQuery: setSearchQuery,
  };
}
