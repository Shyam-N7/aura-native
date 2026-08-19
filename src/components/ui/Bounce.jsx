import React, { useCallback, useEffect, useRef } from 'react';
import { SectionList } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

// Rubber-band overscroll for the app's vertical scrollers. The platform's
// Android-12 stretch effect never renders inside this RN tree (verified on
// device: a held overscroll pull leaves the frame untouched), so the bounce
// is built here, both ways it happens on a real device:
//  - drag past an edge: a pan running simultaneously with the native scroll
//    translates the scroller with asymptotic resistance, springing home on
//    release;
//  - fling INTO an edge: the scroll handler measures the arrival speed and
//    kicks the same band into a short overshoot-and-settle.
// All motion stays on the UI thread.
const AnimatedSectionList = Animated.createAnimatedComponent(SectionList);

// Feel: a drag gives at most RUBBER px of travel, half of it by RUBBER px of
// finger; a fling overshoots up to KICK_MAX px; the settle spring is soft
// enough to read as a bounce.
const RUBBER = 150;
const KICK_MAX = 72;
const BOUNCE_SPRING = { mass: 1, stiffness: 220, damping: 22 };
// Web parity (hooks/useActiveScroll.js): the deep signal relaxes this long
// after the last scroll movement, so the dock's tabs return once you stop.
const IDLE_MS = 2500;

function withRubberBand(Scroller) {
  // onDeepChange / deepThreshold: a boolean "scrolled deep" signal for the
  // dock's back-to-top contraction (lib/scrollDepth). It fires ONCE per
  // threshold crossing — a boundary check inside the existing scroll worklet,
  // never a per-frame JS hop (reports/10 made per-frame work while invisible
  // an explicit anti-pattern).
  return React.forwardRef(function Bouncy(
    // These four are destructured to be DISCARDED, not used — see the note
    // below. Any of them forwarded to the scroller rebuilds the wrapper this
    // component cannot survive, and `onRefresh` does it WITHOUT a control:
    // VirtualizedList synthesises its own RefreshControl from it whenever
    // `refreshControl` is null (VirtualizedList.js — `} else if (onRefresh) {`),
    // so stripping the control alone would leave the trap half open.
    {
      style,
      onDeepChange,
      deepThreshold = 480,
      refreshControl: _rc,
      onRefresh: _or,
      refreshing: _rf,
      progressViewOffset: _pvo,
      ...props
    },
    ref,
  ) {
    const scrollY = useSharedValue(0);
    const prevY = useSharedValue(0);
    const contentH = useSharedValue(0);
    const layoutH = useSharedValue(0);
    const over = useSharedValue(0);
    const anchor = useSharedValue(0);
    const touching = useSharedValue(false);
    const wasDeep = useSharedValue(false);

    // ── Why this wrapper takes no `refreshControl` ───────────────────────
    //
    // It used to, and it cost the app one-finger scrolling on every screen
    // that passed one. The prop is not inert here: on Android RN renders it
    // as the OUTER native view and puts the scroller inside it
    // (ScrollView.js — `cloneElement(refreshControl, …, <NativeScrollView>)`,
    // "On Android wrap the ScrollView with a AndroidSwipeRefreshLayout").
    //
    // That breaks the two things this wrapper is built on:
    //   · `Gesture.Native()` below binds to the GestureDetector's child view.
    //     With a control attached that child is the SwipeRefreshLayout, not
    //     the scroller — so `Gesture.Simultaneous(native, pan)` stops running
    //     the band ALONGSIDE the native scroll and starts competing with it.
    //   · SwipeRefreshLayout intercepts single-pointer vertical drags and
    //     ignores multi-touch, which is exactly the shape the bug had on
    //     device: two fingers scrolled, one finger did nothing.
    // RN also routes `transform` to the outer view when it splits the style,
    // so the band's own translation landed on the wrapper rather than the
    // scroller.
    //
    // A refresh control therefore cannot be hung on these scrollers as-is.
    // Bringing pull-to-refresh back means owning the pull in the pan that is
    // already here, not handing the drag to a second native pipeline — and it
    // means a device pass, because no JS test sees any of the above.

    // ── reduced motion ───────────────────────────────────────────────────
    // The band is decoration on top of a scroll that works perfectly well
    // without it, and it is the most widespread motion in the app: every
    // vertical scroller in every screen goes through this wrapper. With the
    // OS setting on, both halves stand down — the drag stops translating the
    // scroller and a fling arrives at the edge without a kick — which leaves
    // the band at over = 0, its resting AND final value, so nothing is ever
    // frozen part-way or hidden. Read through a shared value rather than the
    // captured prop because the scroll worklet is memoised by
    // useAnimatedScrollHandler and would otherwise keep the first answer.
    const reduced = useReducedMotion();
    const noBand = useSharedValue(!!reduced);
    useEffect(() => {
      noBand.value = !!reduced;
    }, [reduced, noBand]);

    // The idle timer lives on the JS side; worklets ping it only on gesture
    // boundaries. notifyDeep both delivers the signal and cancels any pending
    // revert; armIdle schedules the relax.
    const idle = useRef(null);
    const notifyDeep = useCallback(
      deep => {
        clearTimeout(idle.current);
        if (onDeepChange) {
          onDeepChange(deep);
        }
      },
      [onDeepChange],
    );
    const armIdle = useCallback(() => {
      clearTimeout(idle.current);
      idle.current = setTimeout(() => {
        if (onDeepChange) {
          onDeepChange(false);
        }
      }, IDLE_MS);
    }, [onDeepChange]);
    useEffect(() => () => clearTimeout(idle.current), []);

    const pan = Gesture.Pan()
      .activeOffsetY([-10, 10])
      .onTouchesDown(() => {
        'worklet';
        touching.value = true;
      })
      .onTouchesUp(() => {
        'worklet';
        touching.value = false;
      })
      .onStart(e => {
        'worklet';
        anchor.value = e.translationY;
      })
      .onUpdate(e => {
        'worklet';
        const maxY = Math.max(0, contentH.value - layoutH.value);
        const fits = maxY <= 1;
        const atTop = scrollY.value <= 1;
        const atBottom = !fits && scrollY.value >= maxY - 1;
        const d = e.translationY - anchor.value;
        // `!noBand.value`: reduced motion takes both edges out of the
        // branch chain, so every drag falls through to the re-anchoring
        // branch and the band never leaves 0.
        if ((atTop || fits) && d > 0 && !noBand.value) {
          over.value = RUBBER * (1 - 1 / (1 + d / RUBBER));
        } else if ((atBottom || fits) && d < 0 && !noBand.value) {
          over.value = -RUBBER * (1 - 1 / (1 + -d / RUBBER));
        } else {
          // Inside range: keep re-anchoring so the band starts measuring the
          // moment the list pins at an edge — and if the finger reversed out
          // of an overscroll, ease the band home instead of snapping it (the
          // native scroller starts consuming immediately, so a hard zero
          // here reads as a one-frame jump).
          anchor.value = e.translationY;
          if (over.value !== 0) {
            over.value = over.value * 0.72;
            if (Math.abs(over.value) < 0.5) {
              over.value = 0;
            }
          }
        }
      })
      .onFinalize(() => {
        'worklet';
        touching.value = false;
        // Already 0 under reduced motion; assigned rather than sprung so the
        // release can't run a spring on a band that never stretched.
        over.value = noBand.value ? 0 : withSpring(0, BOUNCE_SPRING);
      });

    const native = Gesture.Native();

    const onScroll = useAnimatedScrollHandler({
      // Re-assert deep the moment a deep list moves again (cancels a pending
      // revert), relax IDLE_MS after the movement stops. Once per gesture,
      // never per frame.
      onBeginDrag: () => {
        if (wasDeep.value && onDeepChange) {
          runOnJS(notifyDeep)(true);
        }
      },
      onMomentumBegin: () => {
        if (wasDeep.value && onDeepChange) {
          runOnJS(notifyDeep)(true);
        }
      },
      onEndDrag: () => {
        if (wasDeep.value && onDeepChange) {
          runOnJS(armIdle)();
        }
      },
      onMomentumEnd: () => {
        if (wasDeep.value && onDeepChange) {
          runOnJS(armIdle)();
        }
      },
      onScroll: e => {
      const y = e.contentOffset.y;
      const maxY = Math.max(
        0,
        e.contentSize.height - e.layoutMeasurement.height,
      );
      // A fling arriving at an edge (no finger down) kicks the band with the
      // last frame's travel as its speed.
      if (!touching.value && over.value === 0 && !noBand.value) {
        const speed = prevY.value - y;
        if (y <= 1 && prevY.value > 1 && speed > 6) {
          const kick = Math.min(KICK_MAX, speed * 1.6);
          over.value = withSequence(
            withTiming(kick, { duration: 100, easing: Easing.out(Easing.quad) }),
            withSpring(0, BOUNCE_SPRING),
          );
        } else if (y >= maxY - 1 && prevY.value < maxY - 1 && -speed > 6) {
          const kick = Math.min(KICK_MAX, -speed * 1.6);
          over.value = withSequence(
            withTiming(-kick, { duration: 100, easing: Easing.out(Easing.quad) }),
            withSpring(0, BOUNCE_SPRING),
          );
        }
      }
      prevY.value = y;
      scrollY.value = y;
      contentH.value = e.contentSize.height;
      layoutH.value = e.layoutMeasurement.height;
      const deep = y > deepThreshold;
      if (deep !== wasDeep.value) {
        wasDeep.value = deep;
        if (onDeepChange) {
          runOnJS(notifyDeep)(deep);
        }
      }
      },
    });

    const bounceStyle = useAnimatedStyle(() => ({
      transform: [{ translateY: over.value }],
    }));

    return (
      <GestureDetector gesture={Gesture.Simultaneous(native, pan)}>
        <Scroller
          ref={ref}
          {...props}
          // The band replaces the platform edge treatment entirely; the
          // dimension seeds below make the very first gesture edge-aware
          // (scroll events haven't fired yet on a fresh screen).
          overScrollMode="never"
          onScroll={onScroll}
          scrollEventThrottle={16}
          onContentSizeChange={(_w, h) => {
            contentH.value = h;
          }}
          onLayout={e => {
            layoutH.value = e.nativeEvent.layout.height;
          }}
          // The scroller is the GestureDetector's direct child and the only
          // thing this style reaches. Both facts are load-bearing — see the
          // refreshControl note above for what happens when a wrapper gets
          // between them.
          style={[style, bounceStyle]}
        />
      </GestureDetector>
    );
  });
}

export const BounceScrollView = withRubberBand(Animated.ScrollView);
export const BounceFlatList = withRubberBand(Animated.FlatList);
export const BounceSectionList = withRubberBand(AnimatedSectionList);
