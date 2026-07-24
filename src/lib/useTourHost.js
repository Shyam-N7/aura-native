import { useCallback, useEffect, useRef, useState } from 'react';
import { findNodeHandle } from 'react-native';
import {
  getTourState,
  startTour,
  subscribeTour,
  tourSeen,
} from './spotlightTour';

// Host-side glue for a spotlight tour. The screen:
//  - puts rootRef on the same View the overlay is mounted in,
//  - spreads anchorRef(key) onto each element it wants spotlit,
//  - passes its scroll ref (for scroll-into-view) and an onStep callback
//    (e.g. to expand a You-screen shelf before its step),
//  - passes `focused` (useIsFocused) so only the visible tab auto-starts and
//    measures — both tabs stay mounted, and the tour state is global,
//  - optionally auto-starts a tour once per device.
//
// Measurement is measureLayout against the ROOT, never measureInWindow: the
// overlay fills that same root, so both live in one coordinate space by
// construction. measureInWindow returns window coords, which include the
// status-bar strip the (opaque) status bar pushes content below — every
// spotlight landed that much too low (field report: "focusing is not proper").
//
// The tour drives itself: on each step it runs onStep (opening whatever the
// step needs), scrolls the target into view, measures it, and hands the rect
// to the overlay, which auto-advances when the dwell elapses. Anything that
// can't be measured falls back to a centered card, so a missing or off-screen
// anchor never stalls the walkthrough.
export function useTourHost({
  scrollRef,
  onStep,
  autoStartTour,
  focused = true,
} = {}) {
  const anchors = useRef({});
  const rootRef = useRef(null);
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
      const rootNode = findNodeHandle(rootRef.current);
      if (cancelled || !node?.measureLayout || rootNode == null) {
        return;
      }
      node.measureLayout(
        rootNode,
        (x, y, width, height) => {
          if (!cancelled && width > 0 && height > 0) {
            setTargets(prev => ({ ...prev, [key]: { x, y, width, height } }));
          }
        },
        () => {},
      );
    };
    scrollIntoView(scrollRef?.current, anchors.current[key]?.current);
    // Layout, the shelf expansion and the scroll each need a beat to land;
    // the late passes also re-seat the ring once the scroll settles.
    const timers = [80, 260, 560, 820, 1100].map(ms => setTimeout(measure, ms));
    measure();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [focused, tour.active, tour.step, tour.steps, scrollRef]);

  return { anchorRef, rootRef, targets };
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
