import { useEffect, useState } from 'react';
import { getFeatured } from '../api/catalog';
import { getUser, getActiveExplicitOff } from '../lib/auth';
import { dropExplicit } from '../lib/explicit';

// The featured pool drives four home sections from ONE fetch (hero = idx 0,
// new-for-you = 1..4, stations = 5..8, quick-picks last-resort fallback) —
// ported from web useFeaturedTracks. The server seeds the pool from the auth
// user's active listening mode (no query param), so the fetch is keyed by mode
// and a future mode switch refetches. Deliberately NOT in homeCache (web
// matches): `status` drives the skeletons and the mode card's curating state.
export function useFeaturedPool({ limit = 24 } = {}) {
  const mode = getUser()?.activeMode ?? 'everyday';
  const [state, setState] = useState({ status: 'loading', tracks: [] });

  useEffect(() => {
    let stale = false;
    setState({ status: 'loading', tracks: [] });
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
