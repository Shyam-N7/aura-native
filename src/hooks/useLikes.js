import { useEffect, useState } from 'react';
import { listLikedIds, likeTrack, unlikeTrack } from '../api/likes';
import { onSessionReset } from '../lib/sessionReset';

// Ported from web src/hooks/useLikes.js: one module-level Set of liked track
// ids as the single source of truth, booted once per app session from
// GET /api/likes?ids=1. like/unlike are optimistic — the Set mutates and
// subscribers re-render immediately, the network call follows, and a failure
// rolls the Set back and rethrows. `ready` flips true only after the first
// successful id load: consumers that filter a server list through isLiked()
// must wait for it or liked content looks empty for a beat (the boot race).

let likedIds = new Set();
let booted = false;
let ready = false;
const subscribers = new Set();

function notify() {
  subscribers.forEach(fn => fn());
}

function boot() {
  if (booted) {
    return;
  }
  booted = true;
  listLikedIds()
    .then(ids => {
      likedIds = new Set(ids);
      ready = true;
      notify();
    })
    .catch(() => {
      // Boot failure resets the flag so the next hook mount retries.
      booted = false;
    });
}

export function isLikedId(id) {
  return likedIds.has(id);
}

export async function like(id) {
  likedIds.add(id);
  notify();
  try {
    await likeTrack(id);
  } catch (err) {
    likedIds.delete(id);
    notify();
    throw err;
  }
}

export async function unlike(id) {
  likedIds.delete(id);
  notify();
  try {
    await unlikeTrack(id);
  } catch (err) {
    likedIds.add(id);
    notify();
    throw err;
  }
}

// Return the store to its pre-boot state — used by tests, and by the Shell on
// an account change: the module Set outlives sign-out, so without this the
// next account inherits the previous one's hearts until the process dies.
// Data only, never `subscribers`: clearing those orphaned every consumer that
// outlives the Shell (field report: after one in-process sign-out the
// notification heart stopped following in-app hearts — PlayerProvider mounts
// above the Shell and its subscribe effect has [] deps, so its bump was gone
// for the rest of the process). The bump is queued rather than called: the
// Shell resets from inside a setState updater, so notifying synchronously
// would push an update into React mid-render.
export function resetLikesStore() {
  likedIds = new Set();
  booted = false;
  ready = false;
  queueMicrotask(notify);
}

onSessionReset(resetLikesStore);

export function useLikes() {
  // `rev` is the counter behind the re-render, exposed rather than discarded.
  //
  // Every other value this hook returns is IDENTITY-STABLE across a like or an
  // unlike: `isLiked` is the module function itself, and `ready` only moves
  // when the store boots. That is fine for rendering — a subscriber re-renders
  // and simply calls isLiked() again — but it means a consumer that MEMOISES
  // over the like-set has nothing honest to put in its dependency array, and
  // will silently freeze. LikedScreen did exactly that and stopped removing
  // rows on unlike. `rev` is the dependency that case needs.
  const [rev, force] = useState(0);
  useEffect(() => {
    boot();
    const bump = () => force(n => n + 1);
    subscribers.add(bump);
    return () => {
      subscribers.delete(bump);
    };
  }, []);
  return { isLiked: isLikedId, ready, like, unlike, rev };
}
