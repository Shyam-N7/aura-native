import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { showToast } from '../lib/toast';

// The consumer half of pull-to-refresh, the way useBackToTop is the consumer
// half of the dock's back-to-top: a screen hands over the fetch it already
// owns and gets back a themed control to hang on its Bounce* scroller.
//
//   const refresh = usePullRefresh(load);
//   <BounceFlatList refreshControl={refresh.control} … />
//
// Why a hook and not eight hand-rolled RefreshControls: the four rules below
// are the whole reason this is subtle, and none of them are visible at the
// call site.
//
//  1. A pull while a refresh is already running is a no-op — the guard is a
//     REF, not state, so a second pull in the same frame can't slip past a
//     render. Without it the scroller happily fires onRefresh again mid-flight
//     and the two responses race to write the same state.
//  2. `refreshing` is driven by the request, never by a timer. The spinner
//     leaves when the data lands, which is the only honest thing it can mean.
//  3. A REJECTED refresh clears the flag exactly like a resolved one. A stuck
//     spinner over a list that is fine is worse than the failure it is
//     reporting, and it is the failure mode of every naive `.then(clear)`.
//  4. The run gets an AbortController signal, so a screen that already threads
//     one through its fetch keeps doing so — and leaving the screen mid-pull
//     aborts the request instead of setting state on a dead component.
//
// The colours: the accent tints the Android arc (`colors`) and the iOS spinner
// (`tintColor`), and `progressBackgroundColor` is the surface token — the same
// raised-card colour every theme already uses behind content, so the puck
// reads as one of the app's own surfaces on dusk, midnight and bloom alike
// (never the stock white disc, which is invisible on dusk and a hole in
// midnight).
export const REFRESH_FAILED = "Couldn't refresh — try again.";

export function usePullRefresh(run, { enabled = true, offset = 0 } = {}) {
  const { t } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  // Rule 1's gate, and the abort handle for rule 4.
  const busy = useRef(false);
  const alive = useRef(true);
  const ctl = useRef(null);
  // The screen's fetch usually closes over fresh state, so read it at call
  // time — onRefresh keeps ONE identity for the life of the screen, which is
  // what keeps the memoized control below from being rebuilt every render.
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(
    () => () => {
      alive.current = false;
      ctl.current?.abort();
    },
    [],
  );

  const onRefresh = useCallback(() => {
    if (busy.current) {
      return undefined;
    }
    busy.current = true;
    setRefreshing(true);
    const own = new AbortController();
    ctl.current = own;
    // Promise.resolve().then() so a run that throws SYNCHRONOUSLY still lands
    // in the catch below rather than escaping with the spinner up.
    return Promise.resolve()
      .then(() => runRef.current(own.signal))
      .catch(err => {
        // A screen's refresh REJECTS to say "I kept what was on screen" — the
        // one thing a pull must never do is trade a list that is already
        // there for an error page because the network blinked. So the report
        // is this sentence, written once, rather than eight screens each
        // inventing their own. A rejection after the screen is gone (or an
        // aborted request) has nobody to tell.
        if (alive.current && err?.name !== 'AbortError') {
          showToast(REFRESH_FAILED);
        }
      })
      .finally(() => {
        busy.current = false;
        if (ctl.current === own) {
          ctl.current = null;
        }
        if (alive.current) {
          setRefreshing(false);
        }
      });
  }, []);

  const control = useMemo(
    () =>
      enabled ? (
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[t.accent]}
          tintColor={t.accent}
          progressBackgroundColor={t.surface}
          progressViewOffset={offset}
        />
      ) : null,
    [enabled, refreshing, onRefresh, offset, t.accent, t.surface],
  );

  return { refreshing, onRefresh, control };
}
