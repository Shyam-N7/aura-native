import { useEffect, useRef, useState } from 'react';
import { getFeatured } from '../api/catalog';
import { getActiveExplicitOff } from '../lib/auth';
import { useActiveMode } from './useActiveMode';
import { dropExplicit } from '../lib/explicit';
import { readSnapshot, snapshotOwner, writeSnapshot } from '../lib/snapshot';

// The featured pool drives four home sections from ONE fetch (hero = idx 0,
// new-for-you = 1..4, stations = 5..8, quick-picks last-resort fallback) —
// ported from web useFeaturedTracks. The server seeds the pool from the auth
// user's active listening mode (no query param), so the fetch is keyed by mode
// and a future mode switch refetches. Deliberately NOT in homeCache (web
// matches): `status` drives the skeletons and the mode card's curating state.
export function useFeaturedPool({ limit = 24 } = {}) {
  // Track the active mode REACTIVELY. Home doesn't re-render on a mode switch
  // (it's a memoized tab screen under the auth-subscribed Shell), so reading
  // getUser() once left the pool stuck on the old mode until an app restart —
  // the checkmark moved but Home didn't.
  //
  // `modeEpoch` is the second half of that. The optimistic flip fires the
  // fetch immediately, which is what makes the switch feel instant — but
  // getFeatured sends no mode param, so that request can beat the POST to the
  // server and come back with the OLD mode's pool, cached under the NEW mode's
  // key for the rest of the session. The epoch changes when the server has
  // confirmed, which the mode string alone cannot express.
  const { mode, epoch: modeEpoch } = useActiveMode();
  // Cold starts seed from the last session's pool for THIS mode (re-filtered
  // in case the explicit rule changed since) — hero/new-for-you/stations paint
  // instantly; the fetch below still runs and swaps the fresh pool in.
  const [state, setState] = useState(() => ({
    status: 'loading',
    tracks: dropExplicit(
      readSnapshot(`featured.${mode}`) ?? [],
      getActiveExplicitOff(),
    ),
  }));

  // First run offline there's no snapshot to fall back on, so home's "couldn't
  // load" state is the only route back to a fetch — `retry` re-runs this one.
  const [attempt, setAttempt] = useState(0);

  const shownMode = useRef(mode);
  useEffect(() => {
    let stale = false;
    const as = snapshotOwner();
    // Stale-while-revalidate: keep the current pool visible while the new
    // mode's loads, so hero / new-for-you / stations don't all blank to
    // skeletons on every switch. EXCEPTION: a mode that filters explicit
    // (family / kids) blanks instead — the previous mode's tracks must never
    // flash under a stricter one. That only applies to an actual SWITCH: on
    // mount the tracks on screen are this mode's own snapshot, already
    // filtered, and blanking them would cost family/kids the instant paint.
    const switched = shownMode.current !== mode;
    shownMode.current = mode;
    setState(s => ({
      status: 'loading',
      tracks: switched && getActiveExplicitOff() ? [] : s.tracks,
    }));
    getFeatured({ limit })
      .then(results => {
        if (!stale) {
          const tracks = dropExplicit(results ?? [], getActiveExplicitOff());
          // `mode` (not a fresh getUser read): the key must match the mode
          // this fetch was keyed by — a swap mid-flight is already discarded
          // via `stale`, so a live resolve always belongs to `mode`.
          writeSnapshot(`featured.${mode}`, tracks, as);
          setState({ status: 'ok', tracks });
        }
      })
      .catch(() => {
        if (!stale) {
          // Keep whatever is already on screen — this mode's snapshot, or the
          // pool a switch is revalidating. A failed refresh must never blank a
          // home that already painted; `status` is all home needs to say so.
          setState(s => ({ status: 'error', tracks: s.tracks }));
        }
      });
    return () => {
      stale = true;
    };
  }, [limit, mode, modeEpoch, attempt]);

  return { ...state, retry: () => setAttempt(n => n + 1) };
}
