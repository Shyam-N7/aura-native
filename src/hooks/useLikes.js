import { useEffect, useState } from 'react';
import { listLikedIds, likeTrack, unlikeTrack } from '../api/likes';

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

export function likesReady() {
  return ready;
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
export function resetLikesStore() {
  likedIds = new Set();
  booted = false;
  ready = false;
  subscribers.clear();
}

export function useLikes() {
  const [, force] = useState(0);
  useEffect(() => {
    boot();
    const bump = () => force(n => n + 1);
    subscribers.add(bump);
    return () => {
      subscribers.delete(bump);
    };
  }, []);
  return { isLiked: isLikedId, ready, like, unlike };
}
