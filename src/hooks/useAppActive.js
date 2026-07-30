import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

// Whether the app is actually visible (activity resumed, screen on). Continuous
// animation must gate on this: ColorOS keeps delivering animation frames with
// the screen off, so a loop that only checks `playing` runs invisibly for
// hours — the heapprofd capture in reports/10 measured ~40 MB/min of native
// heap leaked from exactly that (per-frame worklet execution + Fabric mounts),
// ending in the process kill at ~741 MB. Screen off / app switch both land in
// 'background' on Android, so one check covers both.
export function useAppActive() {
  // Unknown reads as visible: currentState can be null for the first moments
  // of a cold boot (and is a stub under jest) — and the app only ever boots
  // in the foreground. Only a KNOWN background parks the animations.
  const [active, setActive] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', s =>
      setActive(s === 'active'),
    );
    return () => sub.remove();
  }, []);
  return active;
}
