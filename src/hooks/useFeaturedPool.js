import { useEffect, useState } from 'react';
import { getFeatured } from '../api/catalog';
import { getUser, getActiveExplicitOff, subscribeAuth } from '../lib/auth';
import { dropExplicit } from '../lib/explicit';

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
  // the checkmark moved but Home didn't. Subscribing re-seeds it immediately.
  const [mode, setMode] = useState(() => getUser()?.activeMode ?? 'everyday');
  useEffect(
    () => subscribeAuth(() => setMode(getUser()?.activeMode ?? 'everyday')),
    [],
  );
  const [state, setState] = useState({ status: 'loading', tracks: [] });

  useEffect(() => {
    let stale = false;
    // Stale-while-revalidate: keep the current pool visible while the new
    // mode's loads, so hero / new-for-you / stations don't all blank to
    // skeletons on every switch. EXCEPTION: a mode that filters explicit
    // (family / kids) blanks instead — the previous mode's tracks must never
    // flash under a stricter one.
    setState(s => ({
      status: 'loading',
      tracks: getActiveExplicitOff() ? [] : s.tracks,
    }));
    getFeatured({ limit })
      .then(results => {
        if (!stale) {
          setState({
            status: 'ok',
            tracks: dropExplicit(results ?? [], getActiveExplicitOff()),
          });
        }
      })
      .catch(() => {
        if (!stale) {
          setState({ status: 'error', tracks: [] });
        }
      });
    return () => {
      stale = true;
    };
  }, [limit, mode]);

  return state;
}
