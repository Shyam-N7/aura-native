import { useEffect, useState } from 'react';
import { hintDone, subscribeHints } from '../lib/hints';

// True while a hint should still show — flips false (and stays false across
// sessions) the moment its gesture is performed anywhere in the app.
export function useHintActive(id) {
  const [active, setActive] = useState(() => !hintDone(id));
  useEffect(
    () =>
      subscribeHints(doneId => {
        if (doneId === id) {
          setActive(false);
        }
      }),
    [id],
  );
  return active;
}
