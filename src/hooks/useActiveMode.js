import { useEffect, useState } from 'react';
import { getModeEpoch, getUser, subscribeAuth } from '../lib/auth';

// The active listening mode, and whether the SERVER has agreed to it yet.
//
// Home is a memoized tab screen that does not re-render on an auth change, so
// anything mode-dependent has to subscribe for itself. Two readers need this —
// the featured pool and Home's personalization call — and they were doing it
// differently: the pool subscribed and re-fetched, the reco effect had an
// empty dependency array and so never re-ran at all, leaving hero, new-for-you
// and stations on the previous mode for the rest of the session.
//
// `epoch` is the part that is easy to miss. `mode` alone is not enough to
// drive a refetch, because the optimistic flip and the server confirmation
// carry the SAME string: the first sets it, the second is a no-op React bails
// on. Depending on both means a switch fetches once immediately (fast) and
// once more when the server has actually committed (correct).
export function useActiveMode() {
  const [state, setState] = useState(() => ({
    mode: getUser()?.activeMode ?? 'everyday',
    epoch: getModeEpoch(),
  }));
  useEffect(
    () =>
      subscribeAuth(() =>
        setState(prev => {
          const next = {
            mode: getUser()?.activeMode ?? 'everyday',
            epoch: getModeEpoch(),
          };
          // Auth notifies for plenty of reasons that are not a mode switch —
          // an avatar change, a preferences refresh. Keep the same object so
          // effects depending on this don't re-run for those.
          return prev.mode === next.mode && prev.epoch === next.epoch
            ? prev
            : next;
        }),
      ),
    [],
  );
  return state;
}
