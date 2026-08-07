import { useCallback, useContext, useEffect, useRef } from 'react';
import { NavigationContext } from '@react-navigation/native';
import { clearScrollDepth, setScrollDepth } from '../lib/scrollDepth';

// The producer half of the dock's back-to-top contraction.
//
// There is no floating button to share: the control IS the dock, which
// liquid-contracts into the "take me back up" pill and is rendered once for the
// whole app. A screen's entire job is to say "I am scrolled deep" and to hand
// over a way back up (lib/scrollDepth). Home did all of that inline, which is
// why only Home had it.
//
// Spread the return onto any Bounce* scroller, the same way LONG_LIST is
// spread — Bounce already accepts onDeepChange and forwards refs, so no screen
// needs anything else:
//
//   const backToTop = useBackToTop();
//   <BounceFlatList {...backToTop} {...LONG_LIST} … />

// Three scrollers, three different imperative APIs — and Bounce forwards its
// ref STRAIGHT to the underlying RN instance, so what lands in ref.current is
// whichever scroller the screen chose:
//
//   Animated.ScrollView → scrollTo
//   Animated.FlatList   → scrollToOffset, and NO scrollTo at all
//   SectionList         → neither. scrollToLocation needs section/item indices
//                         and lands BELOW ListHeaderComponent, so go through
//                         the ScrollView it wraps instead.
//
// This is the whole reason the hook exists. Home's inline version was
// `ref.current?.scrollTo?.({ y: 0 })`, and every screen being adopted is a
// FlatList or a SectionList — where that optional call swallows the missing
// method and fails SILENTLY. The dock would contract into the pill, and the
// pill would do nothing.
function scrollToTop(node) {
  if (!node) {
    return;
  }
  if (typeof node.scrollToOffset === 'function') {
    node.scrollToOffset({ offset: 0, animated: true });
  } else if (typeof node.scrollTo === 'function') {
    node.scrollTo({ y: 0, animated: true });
  } else {
    node.getScrollResponder?.()?.scrollTo?.({ y: 0, animated: true });
  }
}

export function useBackToTop() {
  // Read from context rather than taking a prop: outside a navigator (tests,
  // standalone renders) there is nothing to be blurred by, so every use below
  // stays optional. Same reasoning as hooks/useNavFocused.
  const navigation = useContext(NavigationContext);
  const ref = useRef(null);
  // Focus is a REF, not state, for two reasons. A parked screen stays mounted —
  // tabs and the native stack both keep them — and Bounce's idle relax is a JS
  // timer, so leaving a deep screen inside that window fires onDeepChange(false)
  // afterwards. Without this gate that late report lands on whichever screen is
  // producing NOW and drops that screen's pill. And state would re-render the
  // whole screen on every tab switch to move a flag nothing renders.
  const focused = useRef(true);

  const onDeepChange = useCallback(deep => {
    if (!focused.current) {
      return;
    }
    setScrollDepth(deep, () => scrollToTop(ref.current));
  }, []);

  useEffect(() => {
    focused.current = navigation?.isFocused?.() ?? true;
    const offFocus = navigation?.addListener?.('focus', () => {
      focused.current = true;
    });
    const offBlur = navigation?.addListener?.('blur', () => {
      focused.current = false;
      // A deep flag must never outlive its screen, or the dock contracts over
      // a screen nobody scrolled.
      clearScrollDepth();
    });
    return () => {
      offFocus?.();
      offBlur?.();
      clearScrollDepth();
    };
  }, [navigation]);

  return { ref, onDeepChange };
}
