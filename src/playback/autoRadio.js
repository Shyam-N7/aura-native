import { getRelated } from '../api/related';
import { dedupeAppend } from './queueModel';

// Endless "more like this" continuation (web src/App.jsx auto-radio, slimmed
// to the native queue model). The context calls noteQueueState on every queue
// change: when the current track becomes the LAST of any non-wrapping queue
// (every source but "tonight's set", repeat off — web prefetch effect), a
// similar-tracks batch is prefetched for its id. At queue end (or next on the
// last track) extend() consumes it — awaiting the in-flight fetch if needed,
// or fetching fresh when the prefetch never fired — and appends it deduped by
// id AND normalized title, flipping source to 'more like this' (web
// applyAutoRadioToQueue). Every fetch retries once on failure so a single
// network blip can't end the session.
//
// The prefetch is also the player's "up next" slot. Nothing sits after the last
// track IN the queue, so without this the sheet has nothing to show at the exact
// moment auto-radio is deciding what plays next. Subscribers get the prefetched
// pick, or the fact that we're still finding it (web autoNextDisplay /
// autoNextLoading).

let state = { seedId: null, promise: null };
// Snapshot handed to React. Replaced (never mutated) only when it actually
// changes, so subscribers can compare by reference.
let snapshot = { seedId: null, candidates: null, loading: false };
const listeners = new Set();

export function getAutoNext() {
  return snapshot;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function publish(next) {
  snapshot = next;
  listeners.forEach(fn => fn(snapshot));
}

const fetchBatch = seed =>
  getRelated(seed.id, { lang: seed.language, limit: 15 }).catch(() =>
    getRelated(seed.id, { lang: seed.language, limit: 15 }),
  );

export function reset() {
  state = { seedId: null, promise: null };
  if (snapshot.seedId !== null || snapshot.loading) {
    publish({ seedId: null, candidates: null, loading: false });
  }
}

export function noteQueueState(queue, repeat = 'off') {
  const atEnd =
    queue.tracks.length > 0 && queue.idx === queue.tracks.length - 1;
  const seed = queue.tracks[queue.idx];
  const eligible =
    atEnd && queue.source !== "tonight's set" && repeat === 'off' && seed?.id;
  if (!eligible) {
    // No longer at the end — but if the batch's seed still IS the current
    // track (the user queued one of the picks behind it; field report:
    // adding one made the rest vanish), keep the batch published. The
    // display dedupes queued picks out, and the moment a NEW last track
    // becomes current the eligible path replaces the batch with that seed's
    // — the honest hand-off. Anything else (jumped to another set, seed
    // left behind, repeat/wrap modes) clears as before.
    const held = state.seedId ?? snapshot.seedId;
    const holdable =
      held != null &&
      held === seed?.id &&
      queue.source !== "tonight's set" &&
      repeat === 'off';
    if (!holdable) {
      reset();
    }
    return;
  }
  if (state.seedId === seed.id) {
    return;
  }
  const promise = fetchBatch(seed)
    .then(list => list ?? [])
    .catch(() => {
      // Both attempts failed — clear so a later extend() fetches fresh.
      if (state.promise === promise) {
        reset();
      }
      return [];
    });
  state = { seedId: seed.id, promise };
  publish({ seedId: seed.id, candidates: null, loading: true });
  promise.then(list => {
    // A reset (queue moved on / both fetches failed) or a newer seed supersedes
    // this batch — only the live prefetch may publish.
    if (state.promise !== promise) {
      return;
    }
    publish({ seedId: seed.id, candidates: list, loading: false });
  });
}

// Returns the queue extended with the continuation batch (idx untouched — the
// caller advances; source flips to 'more like this'), or null when nothing
// playable came back. Consumes the prefetch state either way.
export async function extend(queue) {
  const seed = queue.tracks[queue.idx];
  if (!seed?.id) {
    return null;
  }
  let batch;
  if (state.seedId === seed.id && state.promise) {
    batch = await state.promise;
  } else {
    batch = await fetchBatch(seed).catch(() => null);
  }
  reset();
  if (!batch?.length) {
    return null;
  }
  const extended = dedupeAppend(queue, batch);
  return extended === queue
    ? null
    : { ...extended, source: 'more like this' };
}
