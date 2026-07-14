import { titleKey } from '../utils/title';

// Pure queue-state helpers — no React Native imports, unit-testable in plain
// node. The queue shape is { tracks, idx, source } exactly as in the web app
// (web src/App.jsx queue state); every mutation returns a NEW queue object and
// returns the input unchanged (same reference) when there is nothing to do,
// so callers can cheaply detect no-ops.

const WRAP_SOURCE = "tonight's set";

export function createQueue(tracks = [], idx = 0, source = WRAP_SOURCE) {
  const list = [...tracks];
  const clamped = list.length ? Math.max(0, Math.min(idx, list.length - 1)) : 0;
  return { tracks: list, idx: clamped, source };
}

// What should happen when the current track finishes (or the user hits next on
// the last track). Mirrors the web 'ended' handler decision tree:
//   advance — a next track exists in the queue
//   wrap    — loop (tonight's set / repeat all wrap to 0; repeat one replays)
//   radio   — a non-wrapping queue exhausted: fetch a similar-track continuation
//   stop    — nothing to play (empty queue)
export function decideNext(queue, repeat = 'off') {
  const len = queue?.tracks?.length ?? 0;
  if (!len) {
    return { action: 'stop', nextIdx: 0 };
  }
  if (repeat === 'one') {
    return { action: 'wrap', nextIdx: queue.idx };
  }
  if (queue.idx + 1 < len) {
    return { action: 'advance', nextIdx: queue.idx + 1 };
  }
  if (queue.source === WRAP_SOURCE || repeat === 'all') {
    return { action: 'wrap', nextIdx: 0 };
  }
  // EVERY other exhausted source goes to radio, not just 'more like this' —
  // web runs consumeAutoNext/fetchAutoNext for any non-wrapping queue end
  // (your pick / your set / your selection all keep the music going).
  return { action: 'radio', nextIdx: queue.idx + 1 };
}

export function jumpTo(queue, i) {
  if (!queue.tracks.length) {
    return queue;
  }
  const idx = Math.max(0, Math.min(i, queue.tracks.length - 1));
  return idx === queue.idx ? queue : { ...queue, idx };
}

// Web removeFromQueue semantics: removing before the current track shifts idx
// down; removing the current track keeps idx (the next track slides in), and
// idx is re-clamped when the removed current was last.
export function removeAt(queue, i) {
  if (i < 0 || i >= queue.tracks.length) {
    return queue;
  }
  const tracks = queue.tracks.filter((_, k) => k !== i);
  let idx = queue.idx;
  if (i < queue.idx) {
    idx -= 1;
  } else if (i === queue.idx) {
    idx = Math.min(queue.idx, tracks.length - 1);
  }
  return { ...queue, tracks, idx: Math.max(0, idx) };
}

// Web reorderQueue semantics: pure splice-out/splice-in with idx fixups —
// moving the current track re-points idx at it; moving another track across
// the current shifts idx to keep the same song playing. Out-of-range or
// no-op moves return the queue unchanged.
export function reorder(queue, from, to) {
  const len = queue.tracks.length;
  if (from === to || from < 0 || to < 0 || from >= len || to >= len) {
    return queue;
  }
  const tracks = [...queue.tracks];
  const [moved] = tracks.splice(from, 1);
  tracks.splice(to, 0, moved);
  let idx = queue.idx;
  if (from === idx) {
    idx = to;
  } else if (from < idx && idx <= to) {
    idx -= 1;
  } else if (to <= idx && idx < from) {
    idx += 1;
  }
  return { ...queue, tracks, idx };
}

// Source flips "tonight's set" → 'your set' on first insertion so wrap-around
// turns off once the user starts curating (web enqueueNext/enqueueLast).
const curatedSource = source => (source === WRAP_SOURCE ? 'your set' : source);

export function addNext(queue, track) {
  const tracks = [...queue.tracks];
  tracks.splice(queue.idx + 1, 0, track);
  return { ...queue, tracks, source: curatedSource(queue.source) };
}

export function addToEnd(queue, track) {
  return {
    ...queue,
    tracks: [...queue.tracks, track],
    source: curatedSource(queue.source),
  };
}

// Shuffle the up-next tail — history and the current track stay pinned.
// rng is injectable for deterministic tests.
export function shuffleUpcoming(queue, rng = Math.random) {
  if (queue.tracks.length < 2) {
    return queue;
  }
  const shuffle = arr => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  const tail = queue.tracks.slice(queue.idx + 1);
  if (tail.length >= 2) {
    return {
      ...queue,
      tracks: [...queue.tracks.slice(0, queue.idx + 1), ...shuffle(tail)],
    };
  }
  // Tiny / end-of-queue set (e.g. just 2 tracks): nothing is strictly
  // "up next", so reorder the whole set while keeping the current track
  // playing — re-point idx at it so audio never restarts. Nudge until the
  // order actually changes so the shuffle is visible, not a silent no-op
  // (web shuffleQueue fallback).
  const playing = queue.tracks[queue.idx];
  const original = queue.tracks;
  let tracks = shuffle([...original]);
  for (let n = 0; n < 6 && tracks.every((trk, i) => trk === original[i]); n++) {
    tracks = shuffle([...original]);
  }
  return { ...queue, tracks, idx: tracks.indexOf(playing) };
}

// Append a batch (auto-radio continuation) deduped against the live queue by
// id AND normalized title — a cover / alt-credit of an already-queued song
// (same title, different artist) never gets appended — and deduped within the
// batch itself. Ported from web fetchAutoNext/applyAutoRadioToQueue.
export function dedupeAppend(queue, batch) {
  const haveIds = new Set(queue.tracks.map(t => t.id));
  const haveTitles = new Set(queue.tracks.map(t => titleKey(t.title)));
  const fresh = [];
  for (const t of batch ?? []) {
    const tk = titleKey(t?.title);
    if (!t?.id || haveIds.has(t.id) || haveTitles.has(tk)) {
      continue;
    }
    haveIds.add(t.id);
    haveTitles.add(tk);
    fresh.push(t);
  }
  if (!fresh.length) {
    return queue;
  }
  return { ...queue, tracks: [...queue.tracks, ...fresh] };
}

// Persistence shape: stream URLs carry CDN tokens that rotate, so they are
// never persisted — restore refetches fresh ones (web lib/persistentQueue.js).
export function serializeQueue(queue) {
  const strip = t => {
    if (!t) {
      return t;
    }
    const rest = { ...t };
    delete rest.streamUrl;
    return rest;
  };
  return {
    tracks: (queue?.tracks ?? []).map(strip),
    idx: queue?.idx ?? 0,
    source: queue?.source ?? WRAP_SOURCE,
  };
}
