import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { PressScale } from './PressScale';
import { Icon } from '../Icon';
import {
  backStep,
  endTour,
  getTourState,
  nextStep,
  stepDwell,
  subscribeTour,
  toggleTourPause,
} from '../../lib/spotlightTour';
import { fonts, label } from '../../theme/tokens';
import { DUR, EASE } from '../../theme/motion';

// The self-driving tour overlay: a spotlight cutout (four dim slabs leaving a
// bright window over the step's element + a breathing accent ring) and a
// docked card with plain copy, a dwell bar counting down to the next step,
// progress dots, and hold / back / next / skip. It advances ON ITS OWN — the
// host screen opens and scrolls to whatever each step needs, so the whole
// walkthrough plays without a finger. Tapping the dimmed backdrop HOLDS it
// (tap again to resume) so anything interesting can be read at leisure.
// Anchorless steps (target null) dim the whole screen and center the card —
// the welcome and send-off. All motion is mounted shared values, never
// entering/exiting (the 4.2.3/Fabric abort class). Visual language is shared
// with the player's GestureTourOverlay; that one waits for a real gesture,
// this one drives itself.

const DIM = 0.5;
const GAP = 14; // card distance from the spotlight
const CARD_EST = 200; // first-frame guess, replaced by the measured height
const SAFE_TOP = 44;
const SAFE_BOTTOM = 104; // keep the card clear of the dock area

// Trim the element's rect to what's actually ON SCREEN. A tall section (the
// quick-picks wheel, tonight's set) can run past the viewport, and an outline
// drawn around the whole thing spills off the display and reads as broken —
// the ring should mark the visible part and nothing more.
function visibleRect(r, box) {
  if (!r || !box) {
    return r ?? null;
  }
  const top = Math.max(0, r.y);
  const left = Math.max(0, r.x);
  const bottom = Math.min(box.height, r.y + r.height);
  const right = Math.min(box.width, r.x + r.width);
  if (bottom - top < 8 || right - left < 8) {
    return null; // off-screen — the step falls back to a centered card
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

// Place the card with its REAL height (measured), never a guess, and always
// fully on screen: below the spotlight when it fits, above when it doesn't,
// and clamped into the safe band either way. A card pushed under the dock —
// or past the bottom edge — takes skip/next with it (field report: the middle
// steps "disappeared fully").
function cardPlace(r, box, h) {
  if (!box) {
    return { bottom: 140 };
  }
  const maxTop = Math.max(SAFE_TOP, box.height - SAFE_BOTTOM - h);
  const clamp = v => Math.max(SAFE_TOP, Math.min(maxTop, v));
  if (!r) {
    return { top: clamp(box.height / 2 - h / 2) };
  }
  const below = r.y + r.height + GAP;
  if (below <= maxTop) {
    return { top: below };
  }
  const above = r.y - GAP - h;
  if (above >= SAFE_TOP) {
    return { top: above };
  }
  // The lit area leaves no room on either side — take the roomier side.
  const roomAbove = r.y;
  const roomBelow = box.height - (r.y + r.height);
  return { top: roomAbove > roomBelow ? SAFE_TOP : maxTop };
}

// `tourId` is the tour THIS screen owns. Tour state is global (one engine, any
// screen), and both tabs stay mounted — without this gate the home tour's
// cards also drew over the You screen, anchorless and centered, while home sat
// unlit behind it.
export function SpotlightTourOverlay({ tourId, targets }) {
  const { t } = useTheme();
  const reduced = useReducedMotion();
  const [tour, setTour] = useState(getTourState);
  useEffect(() => subscribeTour(setTour), []);
  const [box, setBox] = useState(null);
  const mine = tour.active && tour.id === tourId;

  // The card cross-fades on every step change; the spotlight itself GLIDES
  // (below) rather than cutting, so the eye is led from one control to the
  // next instead of having to re-find it.
  const scene = useSharedValue(0);
  useEffect(() => {
    if (!mine) {
      return;
    }
    if (reduced) {
      scene.value = 1;
      return;
    }
    scene.value = 0;
    scene.value = withTiming(1, { duration: DUR.screen, easing: EASE.enter });
  }, [mine, tour.step, reduced, scene]);
  const sceneStyle = useAnimatedStyle(() => ({ opacity: scene.value }));

  // The ring breathes with the accent — alive, not a static border.
  const breathe = useSharedValue(0);
  useEffect(() => {
    if (!mine || reduced) {
      return undefined;
    }
    breathe.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 900, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
    return () => cancelAnimation(breathe);
  }, [mine, reduced, breathe]);
  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.65 + 0.35 * breathe.value,
    transform: [{ scale: 1 + 0.012 * breathe.value }],
  }));

  const step = mine ? tour.steps[tour.step] : null;
  const targetKey = step?.target ?? null;
  // Clamped to the viewport: the outline marks the VISIBLE part of a tall
  // section, never a box running off the display.
  const rawRect = targetKey ? (targets?.[targetKey] ?? null) : null;
  const r = visibleRect(rawRect, box);

  // The card's real height, measured — placement never trusts a guess.
  const [cardH, setCardH] = useState(CARD_EST);

  // A step that wants an anchor but hasn't measured it yet gets a short grace
  // window to appear (scroll-into-view, shelf opening). If it still hasn't
  // landed, the step falls back to a centered card rather than a broken
  // off-screen spotlight — the tour always keeps moving.
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    setGraceOver(false);
    if (!mine || !targetKey || r) {
      return undefined;
    }
    const id = setTimeout(() => setGraceOver(true), 900);
    return () => clearTimeout(id);
  }, [mine, tour.step, targetKey, r]);

  // ── the self-driving clock ────────────────────────────────────────────
  // Each step holds for its dwell, then the tour moves on by itself. Holding
  // banks the time left so resuming continues where it stopped rather than
  // restarting the step. The bar below the copy shows the same countdown.
  const dwell = stepDwell(step);
  const paused = !!tour.paused;
  const leftRef = useRef(dwell);
  const fill = useSharedValue(0);
  const stepKey = mine ? `${tour.id}:${tour.step}` : null;

  useEffect(() => {
    leftRef.current = dwell;
    fill.value = 0;
    // A step still hunting for its anchor shouldn't burn its dwell behind a
    // hidden card — the measuring gate below holds the clock too.
  }, [stepKey, dwell, fill]);

  const holding = paused || (!!targetKey && !r && !graceOver);
  useEffect(() => {
    if (!mine || holding) {
      return undefined;
    }
    const started = Date.now();
    const remaining = Math.max(400, leftRef.current);
    if (!reduced) {
      fill.value = withTiming(1, {
        duration: remaining,
        easing: Easing.linear,
      });
    }
    const id = setTimeout(nextStep, remaining);
    return () => {
      clearTimeout(id);
      cancelAnimation(fill);
      leftRef.current = Math.max(0, remaining - (Date.now() - started));
    };
  }, [mine, stepKey, holding, reduced, fill]);

  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: fill.value }],
  }));

  // ── the gliding spotlight ─────────────────────────────────────────────
  // The window travels to each new element instead of cutting: the four dim
  // slabs and the ring all read from one animated rect, so the bright area
  // slides and resizes as one piece and the eye is led to the next control.
  // The first landing snaps (nothing to travel from); every later step eases.
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const sw = useSharedValue(0);
  const sh = useSharedValue(0);
  const litRef = useRef(false);
  const rRef = useRef(r);
  rRef.current = r;
  // Keyed by the rect's VALUES, not its identity — re-measures land a fresh
  // (but equal) object every pass, and restarting the glide on each would
  // stutter the travel mid-flight.
  const rectKey = r ? `${r.x},${r.y},${r.width},${r.height}` : null;
  useEffect(() => {
    const rect = rRef.current;
    if (!rect) {
      litRef.current = false;
      return;
    }
    const glide = v =>
      litRef.current && !reduced
        ? withTiming(v, { duration: 460, easing: EASE.settle })
        : v;
    sx.value = glide(rect.x);
    sy.value = glide(rect.y);
    sw.value = glide(rect.width);
    sh.value = glide(rect.height);
    litRef.current = true;
  }, [rectKey, reduced, sx, sy, sw, sh]);

  const topSlab = useAnimatedStyle(() => ({ height: Math.max(0, sy.value) }));
  const bottomSlab = useAnimatedStyle(() => ({ top: sy.value + sh.value }));
  const leftSlab = useAnimatedStyle(() => ({
    top: sy.value,
    height: sh.value,
    width: Math.max(0, sx.value),
  }));
  const rightSlab = useAnimatedStyle(() => ({
    top: sy.value,
    height: sh.value,
    left: sx.value + sw.value,
  }));
  const ringBox = useAnimatedStyle(() => ({
    left: sx.value - 5,
    top: sy.value - 5,
    width: sw.value + 10,
    height: sh.value + 10,
  }));

  if (!mine) {
    return null;
  }

  const total = tour.steps.length;
  const last = tour.step >= total - 1;
  // Still trying to measure the anchor — hold the card back a beat.
  const measuring = !!targetKey && !r && !graceOver;
  const pos = cardPlace(r, box, cardH);

  return (
    <View
      style={styles.wrap}
      onLayout={e => setBox(e.nativeEvent.layout)}
      accessibilityViewIsModal
    >
      {/* The tour drives itself — tapping the dimming HOLDS it (and resumes),
          so anything worth a longer look can be studied. */}
      <Pressable
        style={styles.fill}
        accessibilityLabel={paused ? 'resume the tour' : 'hold the tour'}
        onPress={toggleTourPause}
      >
        <Animated.View pointerEvents="none" style={[styles.fill, sceneStyle]}>
          {r ? (
            <>
              {/* Four dim slabs leave a bright window over the element —
                  animated as one piece so the window glides between steps. */}
              <Animated.View style={[styles.slab, styles.hEdge, topSlab]} />
              <Animated.View
                style={[styles.slab, styles.hEdge, styles.bottom, bottomSlab]}
              />
              <Animated.View
                style={[styles.slab, styles.edgeLeft, leftSlab]}
              />
              <Animated.View
                style={[styles.slab, styles.edgeRight, rightSlab]}
              />
              <Animated.View
                style={[
                  styles.ring,
                  { borderColor: t.accent },
                  ringBox,
                  ringStyle,
                ]}
              />
            </>
          ) : (
            <View style={[styles.fill, styles.plainDim]} />
          )}
        </Animated.View>
      </Pressable>

      {!measuring && (
        <Animated.View
          accessible
          accessibilityLabel={`${step.title}. ${step.body}`}
          onLayout={e => setCardH(e.nativeEvent.layout.height)}
          style={[styles.cardWrap, pos, sceneStyle]}
          pointerEvents="box-none"
        >
          {/* Swallow taps on the card so only its buttons act. */}
          <Pressable
            onPress={() => {}}
            style={[
              styles.card,
              { backgroundColor: t.surface, borderColor: t.line },
            ]}
          >
            <Text style={[label(9), { color: t.accent }]}>
              {`${tour.step + 1} of ${total}`}
            </Text>
            <Text style={[styles.title, { color: t.ink }]}>{step.title}</Text>
            <Text style={[styles.body, { color: t.inkSoft }]}>{step.body}</Text>

            {/* The countdown to the next step — the tour's own clock, visible
                so nothing moves on unannounced. Frozen while held. */}
            <View style={[styles.dwellTrack, { backgroundColor: t.line }]}>
              <Animated.View
                style={[
                  styles.dwellFill,
                  { backgroundColor: t.accent },
                  fillStyle,
                ]}
              />
            </View>

            <View style={styles.dots}>
              {tour.steps.map((s, i) => (
                <View
                  key={s.title + i}
                  style={[
                    styles.dot,
                    { backgroundColor: i === tour.step ? t.accent : t.line },
                  ]}
                />
              ))}
            </View>

            <View style={styles.row}>
              <PressScale
                accessibilityRole="button"
                accessibilityLabel="skip the tour"
                onPress={endTour}
                hitSlop={8}
              >
                <Text style={[styles.btn, { color: t.inkFaint }]}>skip</Text>
              </PressScale>
              <View style={styles.rowRight}>
                {tour.step > 0 && (
                  <PressScale
                    accessibilityRole="button"
                    accessibilityLabel="back"
                    onPress={backStep}
                    hitSlop={8}
                  >
                    <Text style={[styles.btn, { color: t.inkSoft }]}>back</Text>
                  </PressScale>
                )}
                <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={paused ? 'resume' : 'hold'}
                  onPress={toggleTourPause}
                  hitSlop={8}
                >
                  <Icon
                    name={paused ? 'play' : 'pause'}
                    size={17}
                    color={t.inkSoft}
                  />
                </PressScale>
                <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={last ? 'done' : 'next'}
                  onPress={nextStep}
                  hitSlop={8}
                >
                  <View style={[styles.nextPill, { backgroundColor: t.accent }]}>
                    <Text style={[styles.nextText, { color: t.bg }]}>
                      {last ? 'done' : 'next'}
                    </Text>
                  </View>
                </PressScale>
              </View>
            </View>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: StyleSheet.absoluteFillObject,
  fill: StyleSheet.absoluteFillObject,
  plainDim: { backgroundColor: '#000', opacity: 0.32 },
  slab: {
    position: 'absolute',
    backgroundColor: '#000',
    opacity: DIM,
  },
  hEdge: { left: 0, right: 0 },
  edgeLeft: { left: 0 },
  edgeRight: { right: 0 },
  bottom: { bottom: 0 },
  ring: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: 16,
  },
  cardWrap: {
    position: 'absolute',
    left: 20,
    right: 20,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 4,
  },
  title: { fontFamily: fonts.semibold, fontSize: 17 },
  body: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19 },
  dwellTrack: {
    height: 2,
    borderRadius: 2,
    marginTop: 12,
    overflow: 'hidden',
  },
  dwellFill: {
    height: 2,
    // Scaled from the left edge, so scaleX reads as "how much has elapsed".
    width: '100%',
    transform: [{ scaleX: 0 }],
    transformOrigin: 'left',
  },
  dots: {
    flexDirection: 'row',
    gap: 5,
    marginTop: 10,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  btn: { fontFamily: fonts.medium, fontSize: 13.5 },
  nextPill: {
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  nextText: { fontFamily: fonts.medium, fontSize: 13.5 },
});
