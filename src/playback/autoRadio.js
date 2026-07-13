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

let state = { seedId: null, promise: null };

const fetchBatch = seed =>
  getRelated(seed.id, { lang: seed.language, limit: 15 }).catch(() =>
    getRelated(seed.id, { lang: seed.language, limit: 15 }),
  );

export function reset() {
  state = { seedId: null, promise: null };
}

export function noteQueueState(queue, repeat = 'off') {
  const atEnd =
    queue.tracks.length > 0 && queue.idx === queue.tracks.length - 1;
  const seed = queue.tracks[queue.idx];
  const eligible =
    atEnd && queue.source !== "tonight's set" && repeat === 'off' && seed?.id;
  if (!eligible) {
    reset();
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
