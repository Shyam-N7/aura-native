// In-memory cache for the Home screen's section fetches, ported from web
// src/lib/homeCache.js. Survives HomeScreen unmount/remount (opening the
// player and back) so sections don't re-fetch + cascade-reveal on every
// return; fresh on cold start. Lives here (not module-local to HomeScreen) so
// other screens can invalidate a key when they change what Home shows — e.g.
// hiding a mix track must drop the cached mixes so the shelf can't serve it
// again this session.
import { removeSnapshot } from './snapshot';

export const homeCache = {};

// Dropping a key has to drop its PERSISTED snapshot too — otherwise hiding a
// track clears the in-memory copy while the same list survives on disk and
// seeds the next cold start (and the mix it opens) with the hidden track.
export function invalidateHomeCache(...keys) {
  const drop = k => {
    delete homeCache[k];
    removeSnapshot(`home.${k}`);
  };
  if (!keys.length) {
    for (const k of Object.keys(homeCache)) {
      drop(k);
    }
    return;
  }
  for (const k of keys) {
    drop(k);
  }
}
