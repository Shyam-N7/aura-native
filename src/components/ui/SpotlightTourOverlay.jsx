import React, { useEffect, useState } from 'react';
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
import {
  backStep,
  endTour,
  getTourState,
  nextStep,
  subscribeTour,
} from '../../lib/spotlightTour';
import { fonts, label } from '../../theme/tokens';
import { DUR, EASE } from '../../theme/motion';

// The tap-through tour overlay: a spotlight cutout (four dim slabs leaving a
// bright window over the step's element + a breathing accent ring) and a
// docked card with plain copy, progress dots, and back / next / skip. Tapping
// the dimmed backdrop also advances (web SiteTour parity). Anchorless steps
// (target null) dim the whole screen and center the card — the welcome and
// send-off. All motion is mounted shared values, never entering/exiting (the
// 4.2.3/Fabric abort class). Visual language is shared with the player's
// GestureTourOverlay; this one advances on a tap instead of a gesture.

const DIM = 0.5;
const GAP = 14; // card distance from the spotlight
const CARD_EST = 172; // rough card height for below/above placement
const SAFE_BOTTOM = 96; // keep the card clear of the dock area

function cardTop(r, box) {
  if (!box) {
    return { bottom: 140 };
  }
  const centerTop = Math.max(40, box.height / 2 - CARD_EST / 2);
  if (!r) {
    return { top: centerTop };
  }
  const below = r.y + r.height + GAP;
  if (below + CARD_EST <= box.height - SAFE_BOTTOM) {
    return { top: below };
  }
  const above = r.y - GAP - CARD_EST;
  return { top: above >= 40 ? above : centerTop };
}

export function SpotlightTourOverlay({ targets }) {
  const { t } = useTheme();
  const reduced = useReducedMotion();
  const [tour, setTour] = useState(getTourState);
  useEffect(() => subscribeTour(setTour), []);
  const [box, setBox] = useState(null);

  // Through-fade on every step change (rects reposition while invisible).
  const scene = useSharedValue(0);
  useEffect(() => {
    if (!tour.active) {
      return;
    }
    if (reduced) {
      scene.value = 1;
      return;
    }
    scene.value = 0;
    scene.value = withTiming(1, { duration: DUR.screen, easing: EASE.enter });
  }, [tour.active, tour.step, reduced, scene]);
  const sceneStyle = useAnimatedStyle(() => ({ opacity: scene.value }));

  // The ring breathes with the accent — alive, not a static border.
  const breathe = useSharedValue(0);
  useEffect(() => {
    if (!tour.active || reduced) {
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
  }, [tour.active, reduced, breathe]);
  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.65 + 0.35 * breathe.value,
    transform: [{ scale: 1 + 0.012 * breathe.value }],
  }));

  const step = tour.active ? tour.steps[tour.step] : null;
  const targetKey = step?.target ?? null;
  const r = targetKey ? (targets?.[targetKey] ?? null) : null;

  // A step that wants an anchor but hasn't measured it yet gets a short grace
  // window to appear (scroll-into-view, shelf opening). If it still hasn't
  // landed, the step falls back to a centered card rather than a broken
  // off-screen spotlight — the tour always keeps moving.
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    setGraceOver(false);
    if (!tour.active || !targetKey || r) {
      return undefined;
    }
    const id = setTimeout(() => setGraceOver(true), 900);
    return () => clearTimeout(id);
  }, [tour.active, tour.step, targetKey, r]);

  if (!tour.active) {
    return null;
  }

  const total = tour.steps.length;
  const last = tour.step >= total - 1;
  // Still trying to measure the anchor — hold the card back a beat.
  const measuring = !!targetKey && !r && !graceOver;
  const pos = cardTop(r, box);

  return (
    <View
      style={styles.wrap}
      onLayout={e => setBox(e.nativeEvent.layout)}
      accessibilityViewIsModal
    >
      {/* Tap anywhere on the dimming to advance (card taps are swallowed). */}
      <Pressable
        style={styles.fill}
        accessibilityLabel="next"
        onPress={nextStep}
      >
        <Animated.View pointerEvents="none" style={[styles.fill, sceneStyle]}>
          {r ? (
            <>
              {/* Four dim slabs leave a bright window over the element. */}
              <View style={[styles.slab, styles.hEdge, { height: r.y }]} />
              <View
                style={[styles.slab, styles.hEdge, styles.bottom, { top: r.y + r.height }]}
              />
              <View
                style={[
                  styles.slab,
                  styles.edgeLeft,
                  { top: r.y, height: r.height, width: r.x },
                ]}
              />
              <View
                style={[
                  styles.slab,
                  styles.edgeRight,
                  { top: r.y, height: r.height, left: r.x + r.width },
                ]}
              />
              <Animated.View
                style={[
                  styles.ring,
                  {
                    left: r.x - 5,
                    top: r.y - 5,
                    width: r.width + 10,
                    height: r.height + 10,
                    borderColor: t.accent,
                  },
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
