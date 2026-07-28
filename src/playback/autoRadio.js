import { getRelated } from '../api/related';
import { dedupeAppend } from './queueModel';
import { storage } from '../storage/mmkv';

// The last landed batch, persisted (docs/perf/02 pattern): the module dies
// with the JS process, so every cold reopen used to refetch the SAME picks
// while the sheet said "finding next song". Now the cache publishes instantly
// for the same seed and the fresh fetch replaces it silently in the
// background; offline, the cached batch still carries the session forward.
const CACHE_KEY = 'aura.autoNext.v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Stream URLs carry rotating CDN tokens, so they never go in here — the same
// rule queueModel serializeQueue keeps, and catalog only calls a resolved
// track fresh for 15 min, not 24h. Field report: a stall at the batch boundary
// after a cold reopen, because the cached picks spliced hours-dead links
// straight into the queue and the error ladder had to re-resolve them. The
// picks are what the cache is for; hydration refetches the urls. Applied on
// read too, for entries an older build wrote with urls still in them.
function withoutUrls(candidates) {
  return candidates.map(t => {
    if (!t?.streamUrl) {
      return t;
    }
    const rest = { ...t };
    delete rest.streamUrl;
    return rest;
  });
}

function readCached(seedId) {
  try {
    const raw = JSON.parse(storage.getItem(CACHE_KEY) ?? 'null');
    if (
      raw?.seedId === seedId &&
      Array.isArray(raw.candidates) &&
      raw.candidates.length &&
      Date.now() - raw.fetchedAt < CACHE_TTL_MS
    ) {
      return withoutUrls(raw.candidates);
    }
  } catch {
    // corrupt cache — fetch decides
  }
  return null;
}

function writeCached(seedId, candidates) {
  try {
    storage.setItem(
      CACHE_KEY,
      JSON.stringify({
        seedId,
        candidates: withoutUrls(candidates),
        fetchedAt: Date.now(),
      }),
    );
  } catch {
    // storage full — the session just refetches next boot
  }
}

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

// Single-pick edits (queue-sheet in-place actions): dismiss one, or reorder
// within the suggestions. Both keep the batch a SUGGESTION — nothing enters
// the real queue here — and both write through to the cache so a cold reopen
// shows the list the user last shaped.
export function dropCandidate(id) {
  const c = snapshot.candidates;
  if (!c?.length) {
    return;
  }
  const next = c.filter(x => x.id !== id);
  publish({ ...snapshot, candidates: next });
  if (snapshot.seedId) {
    writeCached(snapshot.seedId, next);
  }
}

// Put `id` where `targetId` currently sits. BY IDENTITY, not by position:
// the displayed list is this array minus whatever is already queued, so a
// displayed index does not address this array — using one moved the wrong
// song the moment a single suggestion had been filtered out.
export function moveCandidate(id, targetId) {
  const c = snapshot.candidates;
  if (!c?.length || id === targetId) {
    return;
  }
  const from = c.findIndex(x => x.id === id);
  const to = c.findIndex(x => x.id === targetId);
  if (from < 0 || to < 0) {
    return;
  }
  const next = c.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  publish({ ...snapshot, candidates: next });
  if (snapshot.seedId) {
    writeCached(snapshot.seedId, next);
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
  const cached = readCached(seed.id);
  const promise = fetchBatch(seed)
    .then(list => list ?? [])
    .catch(() => {
      // Both attempts failed — with a cached batch on screen, keep it (it
      // still plays); bare-handed, clear so a later extend() fetches fresh.
      if (state.promise === promise && !cached) {
        reset();
      }
      return [];
    });
  state = { seedId: seed.id, promise };
  // The cached batch shows the instant the seed matches — "finding next
  // song" only ever appears for a seed we've truly never answered.
  publish({ seedId: seed.id, candidates: cached, loading: !cached });
  promise.then(list => {
    // A reset (queue moved on / both fetches failed) or a newer seed supersedes
    // this batch — only the live prefetch may publish.
    if (state.promise !== promise) {
      return;
    }
    if (list.length) {
      writeCached(seed.id, list);
    }
    publish({
      seedId: seed.id,
      candidates: list.length ? list : cached,
      loading: false,
    });
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
    // Offline (or upstream down) at the queue's end: the cached batch keeps
    // the session moving instead of falling silent.
    batch = readCached(seed.id);
  }
  if (!batch?.length) {
    return null;
  }
  const extended = dedupeAppend(queue, batch);
  return extended === queue
    ? null
    : { ...extended, source: 'more like this' };
}
