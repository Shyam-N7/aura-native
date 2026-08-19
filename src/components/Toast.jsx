import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { subscribeToast } from '../lib/toast';
import { useTheme } from '../theme/ThemeContext';
import { Glass } from './ui/Glass';
import { Icon } from './Icon';
import { fonts, semantic, type } from '../theme/tokens';
import { DUR } from '../theme/motion';

// Success green — reads on all three themes, so it lives in tokens.js as an
// app-wide semantic colour rather than in here.
const TICK_GREEN = semantic.success;

// The action's own height. 38 of control + 5 of hitSlop top and bottom is the
// 48dp floor the app's touch passes hold everything to, and the slop has to
// stay INSIDE the pill: Glass clips to its own bounds (overflow: hidden) and
// Android drops a touch that lands outside the parent, so a slop that spills
// past the pill's edge would simply not be there. The pill's vertical padding
// drops to 5 to match, which keeps an actionable toast 48 tall rather than 58.
const ACTION_H = 38;
const ACTION_SLOP = { top: 5, bottom: 5, left: 8, right: 8 };

// Renders the most recent toast (last-write-wins), ported from web Toast.jsx.
// Web toast motion: rise 16 + scale .96 in, reverse out, short hold — all
// driven by ONE mounted shared value. entering/exiting props are banned here:
// the pill is a null-gated view replaced per toast, the documented reanimated
// 4.2.3 abort class (an exit animation on a churny conditional view aborts
// the native process — this was crashing the app in the field).
export function Toast() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [current, setCurrent] = useState(null);
  // 0 → hidden, 1 → landed. Drives opacity/rise/scale of the pill.
  const pill = useSharedValue(0);
  // The success tick pops in just after the pill lands — a beat of "done".
  const tickScale = useSharedValue(0);

  // The toast on screen, read by the tap handler. A ref rather than a dep so
  // the handler keeps one identity for the pill's whole life — a Pressable
  // that re-created itself mid-animation is a control moving under the thumb.
  const liveRef = useRef(null);
  liveRef.current = current;
  // The id whose action already ran: the once-guard. The hold timer and a
  // second tap both race the first tap, and an undo that fires twice re-adds
  // a track twice.
  const takenRef = useRef(0);
  // True while an undo is still takeable — an offer holds the floor.
  const holdRef = useRef(false);
  // The one message waiting behind that offer (newest wins).
  const queuedRef = useRef(null);
  // The out/unmount pair, held so a tap can cancel them mid-flight.
  const timers = useRef({ out: null, unmount: null });
  const clearTimers = useCallback(() => {
    clearTimeout(timers.current.out);
    clearTimeout(timers.current.unmount);
    timers.current = { out: null, unmount: null };
  }, []);

  useEffect(
    () =>
      subscribeToast(next => {
        // Replace or queue? Last-write-wins is right for statements: the
        // newest news is the truest, and a missed "Saved." costs nothing. An
        // undo is not a statement, it is an offer with a deadline, and
        // swallowing it for "Added to your queue." takes away the only way
        // back from something destructive — silently, while the thumb is
        // already moving. So a live offer holds the floor and the newer
        // message waits. ONE slot, newest wins: a burst of toasts must not
        // build a backlog of stale pills to sit through.
        if (holdRef.current) {
          queuedRef.current = next;
          return;
        }
        queuedRef.current = null;
        setCurrent(next);
      }),
    [],
  );

  useEffect(() => {
    if (!current) {
      // The floor is free — a message that waited behind an undo goes up.
      const next = queuedRef.current;
      if (next) {
        queuedRef.current = null;
        setCurrent(next);
      }
      return undefined;
    }
    holdRef.current = !!current.action;
    pill.value = 0;
    pill.value = reduced ? 1 : withTiming(1, { duration: DUR.toastIn });
    if (current.tick) {
      tickScale.value = 0;
      tickScale.value = reduced
        ? 1
        : withDelay(
            DUR.toastIn * 0.6,
            withSpring(1, { mass: 1, stiffness: 320, damping: 14 }),
          );
    }
    // Hold, animate out, THEN unmount — the timer chain (not a worklet
    // callback) sequences it, and both timers clear if a newer toast lands.
    // An actionable toast holds far longer: reading it, finding the control
    // and reaching it does not fit in the statement window.
    const hold = current.action ? DUR.toastHoldAction : DUR.toastHold;
    timers.current.out = setTimeout(() => {
      // The offer expired unanswered; whatever was waiting is free to land.
      holdRef.current = false;
      pill.value = reduced ? 0 : withTiming(0, { duration: DUR.toastIn });
      timers.current.unmount = setTimeout(
        () => setCurrent(c => (c?.id === current.id ? null : c)),
        reduced ? 0 : DUR.toastIn,
      );
    }, DUR.toastIn + hold);
    return clearTimers;
  }, [current, reduced, pill, tickScale, clearTimers]);

  // Tap the action: dismiss now, run the handler once.
  const takeAction = useCallback(() => {
    const live = liveRef.current;
    if (!live?.action || takenRef.current === live.id) {
      return;
    }
    takenRef.current = live.id;
    holdRef.current = false;
    // Cancelling the hold pair FIRST is what makes the tap and the expiry
    // safe to collide: whichever timer was about to fire is gone, and the
    // exit below is the only one running. The pill answers the tap
    // immediately — it is not waiting on the handler's network call.
    clearTimers();
    pill.value = reduced ? 0 : withTiming(0, { duration: DUR.toastIn });
    timers.current.unmount = setTimeout(
      () => setCurrent(c => (c?.id === live.id ? null : c)),
      reduced ? 0 : DUR.toastIn,
    );
    live.action.onPress();
  }, [clearTimers, pill, reduced]);

  const pillStyle = useAnimatedStyle(() => ({
    opacity: pill.value,
    transform: [
      { translateY: 16 * (1 - pill.value) },
      { scale: 0.96 + 0.04 * pill.value },
    ],
  }));

  const tickStyle = useAnimatedStyle(() => ({
    transform: [{ scale: tickScale.value }],
  }));

  if (!current) {
    return null;
  }
  const { action } = current;
  // Without an action the wrap stays exactly as untouchable as it always was.
  // With one, EVERY view between the wrap and the control has to be box-none,
  // not just the outer two: box-none means "not me, try my children", and
  // Android stops at the first child that hit-tests — so a single `auto` view
  // anywhere in the chain becomes a target with no handler and swallows the
  // tap. The glass shell was that view, which turned an undo pill into a
  // 5-second dead zone over the screen beneath it.
  //
  // The copy is wrapped rather than marked: on Android ReactTextView does not
  // honour pointerEvents at all, so `none` on the <Text> is a no-op and the
  // words themselves would keep eating taps.
  const touch = action ? 'box-none' : 'none';
  return (
    <View
      pointerEvents={touch}
      style={[styles.wrap, { bottom: insets.bottom + 88 }]}
    >
      <Animated.View pointerEvents={touch} style={pillStyle}>
        <Glass
          radius={22}
          pointerEvents={touch}
          style={[styles.pill, !!action && styles.pillAction]}
        >
          <View pointerEvents={touch} style={styles.row}>
            <View pointerEvents="none" style={styles.copy}>
              {current.tick && (
                <Animated.View style={[styles.tick, tickStyle]}>
                  <Icon name="check" size={11} color="#fff" strokeWidth={2.4} />
                </Animated.View>
              )}
              <Text style={[type.body, styles.text, { color: t.ink }]}>
                {current.message}
              </Text>
            </View>
            {!!action && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={action.label.toLowerCase()}
                onPress={takeAction}
                hitSlop={ACTION_SLOP}
                style={({ pressed }) => [
                  styles.action,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.actionText, { color: t.accent }]}>
                  {action.label}
                </Text>
              </Pressable>
            )}
          </View>
        </Glass>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    // Topmost of everything. The player (elevation 14) and action sheets
    // (elevation 24) would otherwise bury a toast fired from over them — on
    // this device elevation outranks sibling paint order, so a toast added
    // from the open player never showed. The wrap is transparent + no-touch,
    // so this lifts draw order without a shadow, slab, or blocked taps.
    zIndex: 100,
    elevation: 40,
  },
  pill: {
    maxWidth: '82%',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  // 5 + 38 + 5 = the 48dp the action needs, with the slop inside the pill.
  pillAction: { paddingVertical: 5, paddingRight: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // Holds the tick and the message so they can be made untouchable as one.
  // flexShrink keeps the pill's maxWidth shrink behaviour intact.
  copy: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  tick: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: TICK_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontFamily: fonts.medium, flexShrink: 1 },
  action: {
    minHeight: ACTION_H,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  actionText: { ...type.body, fontFamily: fonts.medium },
  pressed: { opacity: 0.6 },
});
