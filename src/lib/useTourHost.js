import { useCallback, useEffect, useRef, useState } from 'react';
import { findNodeHandle } from 'react-native';
import {
  getTourState,
  startTour,
  subscribeTour,
  tourSeen,
} from './spotlightTour';

// Host-side glue for a spotlight tour. The screen:
//  - spreads anchorRef(key) onto each element it wants spotlit,
//  - passes its scroll ref (for scroll-into-view) and an onStep callback
//    (e.g. to expand a You-screen shelf before its step),
//  - passes `focused` (useIsFocused) so only the visible tab auto-starts and
//    measures — both tabs stay mounted, and the tour state is global,
//  - optionally auto-starts a tour once per device.
// On each active step this runs onStep, scrolls the target into view, then
// measures it into a window rect the SpotlightTourOverlay consumes. Anything
// that can't be measured falls back to a centered card in the overlay, so a
// missing or off-screen anchor never stalls the tour.
export function useTourHost({
  scrollRef,
  onStep,
  autoStartTour,
  focused = true,
} = {}) {
  const anchors = useRef({});
  const [targets, setTargets] = useState({});
  const [tour, setTour] = useState(getTourState);
  useEffect(() => subscribeTour(setTour), []);

  // Stable object ref per key — same identity across renders so React doesn't
  // thrash the ref callback.
  const anchorRef = useCallback(key => {
    if (!anchors.current[key]) {
      anchors.current[key] = { current: null };
    }
    return anchors.current[key];
  }, []);

  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;

  // Auto-start once per device, and only from the focused tab (replay from
  // Settings ignores the seen flag).
  const autoRef = useRef(autoStartTour);
  const startedRef = useRef(false);
  useEffect(() => {
    const def = autoRef.current;
    if (!focused || startedRef.current || !def || tourSeen(def.id)) {
      return undefined;
    }
    startedRef.current = true;
    const id = setTimeout(() => startTour(def), 700);
    return () => clearTimeout(id);
  }, [focused]);

  useEffect(() => {
    if (!focused || !tour.active) {
      return undefined;
    }
    const step = tour.steps[tour.step];
    onStepRef.current?.(step);
    const key = step?.target;
    if (!key) {
      return undefined; // centered step — nothing to measure
    }
    let cancelled = false;
    const measure = () => {
      const node = anchors.current[key]?.current;
      if (cancelled || !node?.measureInWindow) {
        return;
      }
      node.measureInWindow((x, y, width, height) => {
        if (!cancelled && width > 0 && height > 0) {
          setTargets(prev => ({ ...prev, [key]: { x, y, width, height } }));
        }
      });
    };
    scrollIntoView(scrollRef?.current, anchors.current[key]?.current);
    // Layout, shelf expansion and the scroll each need a beat to land.
    const timers = [80, 260, 560, 820].map(ms => setTimeout(measure, ms));
    measure();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [focused, tour.active, tour.step, tour.steps, scrollRef]);

  return { anchorRef, targets };
}

// Best-effort: bring the anchor into view before the spotlight lands. Any
// failure is swallowed — the overlay falls back to a centered card.
function scrollIntoView(scroller, node) {
  if (!scroller?.scrollTo || !node?.measureLayout) {
    return;
  }
  try {
    const inner = scroller.getScrollableNode
      ? findNodeHandle(scroller.getScrollableNode())
      : findNodeHandle(scroller);
    if (inner == null) {
      return;
    }
    node.measureLayout(
      inner,
      (_x, y) => {
        scroller.scrollTo({ y: Math.max(0, y - 140), animated: true });
      },
      () => {},
    );
  } catch {
    // best-effort only
  }
}
