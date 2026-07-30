import React, { useCallback, useEffect, useRef } from 'react';
import { SectionList } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
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
    { style, onDeepChange, deepThreshold = 480, ...props },
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
        if ((atTop || fits) && d > 0) {
          over.value = RUBBER * (1 - 1 / (1 + d / RUBBER));
        } else if ((atBottom || fits) && d < 0) {
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
        over.value = withSpring(0, BOUNCE_SPRING);
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
      if (!touching.value && over.value === 0) {
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
          style={[style, bounceStyle]}
        />
      </GestureDetector>
    );
  });
}

export const BounceScrollView = withRubberBand(Animated.ScrollView);
export const BounceFlatList = withRubberBand(Animated.FlatList);
export const BounceSectionList = withRubberBand(AnimatedSectionList);
