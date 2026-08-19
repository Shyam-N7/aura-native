import { useCallback, useEffect, useRef, useState } from 'react';
import { showToast } from '../lib/toast';

// The consumer half of a refresh: a screen hands over the fetch it already
// owns and gets back a guarded runner plus an honest `refreshing` flag.
//
//   const refresh = usePullRefresh(load);
//   if (refresh.refreshing) { … }
//
// ── There is deliberately no RefreshControl here ─────────────────────────
// This hook used to return one, and screens hung it on their Bounce*
// scroller. On Android that prop makes RN render the control as the OUTER
// native view with the scroller inside it, which put a SwipeRefreshLayout
// between the GestureDetector and the scroller in Bounce.jsx — and cost the
// app one-finger scrolling on all eight screens that used it. The full
// mechanism is written up at the top of src/components/ui/Bounce.jsx.
//
// So the gesture is gone for now and `onRefresh` has no caller: `refreshing`
// stays false, which is exactly the state these screens were in before
// pull-to-refresh was added, and the guards that read it still hold. The
// rules below are kept intact because they are the hard part, and whatever
// re-introduces the pull — a pan owned by Bounce, not a second native
// pipeline — should re-use them rather than rediscover them.
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
export const REFRESH_FAILED = "Couldn't refresh — try again.";

// A second argument is accepted and ignored: it configured the control's
// enablement and spinner offset, and callers still pass it. It comes back
// with the control.
export function usePullRefresh(run) {
  const [refreshing, setRefreshing] = useState(false);
  // Rule 1's gate, and the abort handle for rule 4.
  const busy = useRef(false);
  const alive = useRef(true);
  const ctl = useRef(null);
  // The screen's fetch usually closes over fresh state, so read it at call
  // time — onRefresh keeps ONE identity for the life of the screen, so a
  // consumer can hold it in a dep array without rebuilding every render.
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

  return { refreshing, onRefresh };
}
