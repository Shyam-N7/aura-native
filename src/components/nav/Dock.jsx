import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { Circle, RoundedRect } from '@shopify/react-native-skia';
import { Icon } from '../Icon';
import { Bead, BEAD_SIZE } from '../player/Bead';
import { Glass } from '../ui/Glass';
import { Goo } from '../ui/Goo';
import { PressScale } from '../ui/PressScale';
import { useTheme } from '../../theme/ThemeContext';
import { usePlayer } from '../../playback/PlayerContext';
import { subscribeScrollDepth } from '../../lib/scrollDepth';
import { fonts, gooFill, label, radii } from '../../theme/tokens';
import { DUR, EASE } from '../../theme/motion';

const TAB_ICONS = { Home: 'home', Search: 'search', Talk: 'chat', You: 'user' };

// The dock is an app-level overlay, not the tab navigator's tabBar: detail
// screens (playlist, artist, liked…) live on the ROOT stack above the tabs,
// and as a tabBar the dock vanished on all of them (field report). The tab
// set is static, so it needs no descriptors — just the container ref for the
// active index and navigation.
const TABS = [
  { name: 'Home', label: 'Home' },
  { name: 'Search', label: 'Search' },
  { name: 'Talk', label: 'Talk' },
  { name: 'You', label: 'You' },
];

// How much vertical room the floating chrome needs under scrolling content.
export const DOCK_CLEARANCE = 96;

// Goo canvas bleeds past the dock so the blur has room to merge shapes.
const GOO_PAD = 14;
const GOO_WINDOW_MS = 460;

// Back-to-top contraction (web MobileDock --btt): the dock narrows to this
// centered pill while the nav items melt to centre through the goo.
const BTT_WIDTH = 200;
const BTT_MS = 420;

// Focused tab off a root nav state: root stack route 0 is the Tabs navigator;
// its nested index is the focused tab (0 until the tab navigator has state).
const tabIndexOf = state => state?.routes?.[0]?.state?.index ?? 0;

function DockTab({ route, focused, label: tabLabel, tint, accent, onPress, index = 0, bttV }) {
  const reduced = useReducedMotion();
  const dot = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    dot.value = reduced
      ? focused
        ? 1
        : 0
      : withTiming(focused ? 1 : 0, { duration: DUR.dot, easing: EASE.settle });
  }, [focused, dot, reduced]);
  const dotStyle = useAnimatedStyle(() => ({ transform: [{ scale: dot.value }] }));
  // Back-to-top melt: each tab slides toward the dock's centre as the capsule
  // contracts (web --btt nth-child ±150%/±50%), measured off its own width so
  // the row's flex layout stays untouched.
  const [w, setW] = useState(0);
  const meltStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: bttV ? (1.5 - index) * w * bttV.value : 0 },
    ],
  }));

  return (
    // The melt lives on a wrapper: PressScale writes `transform` for its own
    // press-squash, and two transform-writing styles on one node means the
    // later one erases the earlier — the wrapper keeps both motions alive.
    <Animated.View
      style={[styles.tab, meltStyle]}
      onLayout={e => setW(e.nativeEvent.layout.width)}
    >
      <PressScale
        accessibilityRole="button"
        accessibilityState={focused ? { selected: true } : {}}
        accessibilityLabel={tabLabel}
        onPress={onPress}
        style={styles.tabInner}
      >
        <Icon name={TAB_ICONS[route.name]} size={22} color={tint} />
        <Text style={[label(7.5), { color: tint }]}>{tabLabel}</Text>
        <Animated.View style={[styles.dot, { backgroundColor: accent }, dotStyle]} />
      </PressScale>
    </Animated.View>
  );
}

// The web's "mercury dock": a floating glass capsule with the now-playing bead
// budding off its left end. Content scrolls underneath (screens pad by
// DOCK_CLEARANCE); when a track loads the bead metaball-fuses out of the capsule.
export function Dock({ navRef }) {
  const { name, t } = useTheme();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const reduced = useReducedMotion();
  const hasTrack = !!player.current;

  // Active tab. The 'state' listener adopts the state carried BY the event —
  // never a container re-read that could trail the commit — and syncTab is
  // the on-demand live read for the moments no event will come.
  const [tabIndex, setTabIndex] = useState(0);
  const syncTab = useCallback(() => {
    if (navRef?.isReady?.()) {
      setTabIndex(tabIndexOf(navRef.getRootState()));
    }
  }, [navRef]);
  useEffect(() => {
    syncTab();
    return navRef?.addListener?.('state', e => {
      if (e?.data?.state) {
        setTabIndex(tabIndexOf(e.data.state));
      }
    });
  }, [navRef, syncTab]);

  // Navigating to the Tabs route pops any detail screens off the root stack
  // AND focuses the tapped tab — one gesture gets you home from anywhere.
  // Always dispatched: gating on the highlight deadlocked the dock whenever
  // the highlight went stale — navigate-to-current emits no state event, so
  // no tap or slide could ever correct it again (field report: parked on
  // "you" over the home screen). navigate() to the focused tab is already a
  // no-op internally, and syncTab heals the highlight in exactly that silent
  // case.
  const goTab = tabName => {
    if (navRef?.isReady?.()) {
      navRef.navigate('Tabs', { screen: tabName });
      syncTab();
    }
  };

  const [width, setWidth] = useState(0);
  const [rowW, setRowW] = useState(0);
  const [gooActive, setGooActive] = useState(false);
  const firstRender = useRef(true);
  const budR = useSharedValue(BEAD_SIZE / 2);

  // Back-to-top mode: the focused screen reports "scrolled deep" through
  // lib/scrollDepth and the whole dock liquid-contracts to a centered
  // "take me back up" pill (web MobileDock mode='backtotop'). bttV drives
  // every piece of the choreography off one clock.
  const [btt, setBtt] = useState(false);
  const toTopRef = useRef(null);
  const bttV = useSharedValue(0);
  useEffect(
    () =>
      subscribeScrollDepth(s => {
        toTopRef.current = s.toTop;
        setBtt(s.deep);
      }),
    [],
  );
  useEffect(() => {
    // The liquid overshoot, BOTH directions — settle made the return feel
    // dead next to the web's springy landing (owner report). Consumers that
    // can't survive bttV briefly leaving 0..1 clamp where they read it.
    bttV.value = reduced
      ? btt
        ? 1
        : 0
      : withTiming(btt ? 1 : 0, { duration: BTT_MS, easing: EASE.liquid });
  }, [btt, bttV, reduced]);

  // Goo window: opaque silhouettes ride the metaball filter for the MORPH
  // moments only, then the real glass swaps back in — same one-window rule as
  // the web (`filter` at rest would just blur the chrome). Two triggers share
  // it: a track first appearing (the bead buds out of the capsule) and the
  // back-to-top flip (the capsule contracts, items melt to centre).
  const prevTrack = useRef(hasTrack);
  const prevBtt = useRef(btt);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      prevTrack.current = hasTrack;
      prevBtt.current = btt;
      return undefined;
    }
    const trackFlipped = prevTrack.current !== hasTrack;
    const bttFlipped = prevBtt.current !== btt;
    prevTrack.current = hasTrack;
    prevBtt.current = btt;
    // Reduced motion: no goo window at all, and — the part that used to be
    // implicit — the bead silhouette is written straight to its FINAL radius
    // instead of budding there. It was only ever safe because the window
    // below happens to be gated too; a one-line change to that condition
    // would have quietly re-armed a 260ms grow the listener switched off.
    if (reduced) {
      budR.value = BEAD_SIZE / 2;
      setGooActive(false);
      return undefined;
    }
    // bttFlipped keeps the RETURN morph covered with no track loaded:
    // (hasTrack || btt) alone goes false on that flip, so the capsule
    // re-expanded with the blur LIVE mid-resize — BlurView re-crops per
    // layout pass and printed a displaced pill outline (owner's ghost,
    // the no-disc crops). Solid + goo must ride every geometry change.
    if (hasTrack || btt || bttFlipped) {
      setGooActive(true);
      // The bud animation belongs to the track appearing — a back-to-top flip
      // reuses the window but must not re-bud a bead that was already out
      // (its silhouette RETRACTS instead, via the (1 - bttV) factor below).
      if (trackFlipped && hasTrack) {
        budR.value = BEAD_SIZE * 0.1;
        budR.value = withTiming(BEAD_SIZE / 2, { duration: DUR.bud, easing: EASE.settle });
      }
      const id = setTimeout(() => setGooActive(false), GOO_WINDOW_MS);
      return () => clearTimeout(id);
    }
    setGooActive(false);
    return undefined;
  }, [hasTrack, btt, budR, reduced]);

  // Silhouette geometry for the goo window, all off the same two clocks.
  // Bead: buds with budR, retracts with btt. Capsule: narrows to the centered
  // pill. Item blobs: the four tabs' masses converging on centre so the
  // metaball fuses them into the contracting capsule (web --btt ::before).
  // No track = NO bead blob: budR idles at full size, so an unguarded
  // radius painted a phantom bead into every no-track goo window (the
  // owner's left-edge lines — and with a track, padL shifts the item
  // blobs 56px right, which is why the lines "moved" with the disc).
  // Min-cap: the liquid clock dips below 0 on return, and (1 - bttV)
  // past 1 would inflate the blob beyond the real bead.
  const beadSilR = useDerivedValue(
    () =>
      hasTrack
        ? Math.min(BEAD_SIZE / 2, Math.max(0, budR.value * (1 - bttV.value)))
        : 0,
    [hasTrack],
  );
  const capSilW = useDerivedValue(() =>
    interpolate(bttV.value, [0, 1], [width, BTT_WIDTH], 'clamp'),
  );
  const capSilX = useDerivedValue(
    () => GOO_PAD + (width - capSilW.value) / 2,
  );
  // 2px-inset twins for the drawn silhouette (see the RoundedRect note).
  const capSilWIn = useDerivedValue(() => Math.max(0, capSilW.value - 4));
  const capSilXIn = useDerivedValue(() => capSilX.value + 2);
  const itemCxAt = i => {
    'worklet';
    const padL = hasTrack ? 60 : 4;
    const usable = width - padL - 4;
    const base = GOO_PAD + padL + (usable / TABS.length) * (i + 0.5);
    return interpolate(bttV.value, [0, 1], [base, GOO_PAD + width / 2]);
  };
  const itemSil0 = useDerivedValue(() => itemCxAt(0));
  const itemSil1 = useDerivedValue(() => itemCxAt(1));
  const itemSil2 = useDerivedValue(() => itemCxAt(2));
  const itemSil3 = useDerivedValue(() => itemCxAt(3));
  const itemSilCx = [itemSil0, itemSil1, itemSil2, itemSil3];

  // The visible chrome follows the same clock as the silhouettes.
  const capsuleStyle = useAnimatedStyle(() => ({
    // clamp: the liquid overshoot must not poke the capsule past its slot.
    width:
      width > 0
        ? interpolate(bttV.value, [0, 1], [width, BTT_WIDTH], 'clamp')
        : undefined,
    alignSelf: 'center',
  }));
  // Nav row fades and shrinks out ahead of the label (web: opacity 200ms,
  // scale .86); items also converge via per-item meltX so the real chrome
  // matches what the metaball silhouettes are doing.
  const rowMeltStyle = useAnimatedStyle(() => ({
    opacity: interpolate(bttV.value, [0, 0.55], [1, 0], 'clamp'),
    transform: [{ scale: 1 - bttV.value * 0.14 }],
  }));
  const bttLabelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(bttV.value, [0.55, 1], [0, 1], 'clamp'),
    transform: [{ scale: 0.85 + bttV.value * 0.15 }],
  }));
  const beadRetractStyle = useAnimatedStyle(() => {
    // Floor at 0: a liquid overshoot past 1 would mirror-flip the bead.
    const s = Math.max(0, 1 - bttV.value);
    return {
      opacity: Math.min(1, s),
      transform: [{ scale: s }],
    };
  });

  // Tabs slide right to clear the bead (web: padding-left 60).
  const padLeft = useSharedValue(hasTrack ? 60 : 4);
  useEffect(() => {
    // Lands on the final padding in one frame under reduced motion — the row
    // still clears the bead, it just doesn't slide there. This one was the
    // real leak: unlike the goo window two effects up, nothing above it was
    // gated, so every track change slid the tabs 56px regardless.
    const to = hasTrack ? 60 : 4;
    padLeft.value = reduced
      ? to
      : withTiming(to, { duration: DUR.bud, easing: EASE.settle });
  }, [hasTrack, reduced, padLeft]);
  const rowStyle = useAnimatedStyle(() => ({ paddingLeft: padLeft.value }));

  // Hold-and-slide across the dock to switch tabs — iPhone-camera-mode style.
  // During the slide the highlight follows the finger (a haptic tick at each
  // boundary) via dragTab, but we DON'T navigate yet: focusing each crossed tab
  // mid-slide would pop Search's keyboard and mount the pass-through screens'
  // side effects. The switch commits ONCE, on release, to the tab the finger
  // last landed on. Taps fall straight through — the pan only arms past 12px of
  // horizontal travel, so a tap never trips it. swipeIdx (UI-thread) gates the
  // JS hop so we cross to react land once per tab, not once per frame.
  const [dragTab, setDragTab] = useState(null);
  const swipeIdx = useSharedValue(-1);
  const activeIndex = dragTab != null ? dragTab : tabIndex;
  const onSwipeTick = useCallback(i => {
    setDragTab(i);
    Vibration.vibrate(6);
  }, []);
  const commitSwipe = useCallback(
    i => {
      setDragTab(null);
      // One navigation on release — no pass-through tab is ever focused.
      // Unconditional for the same reason as goTab: landing on the current
      // tab is a no-op inside navigate(), and syncTab re-trues the highlight
      // so a stale one can't dead-end the slide.
      const tab = TABS[i];
      if (tab && navRef?.isReady?.()) {
        navRef.navigate('Tabs', { screen: tab.name });
        syncTab();
      }
    },
    [navRef, syncTab],
  );
  const cancelSwipe = useCallback(() => setDragTab(null), []);
  const tabSwipe = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-12, 12])
        .onBegin(() => {
          'worklet';
          swipeIdx.value = -1;
        })
        .onUpdate(e => {
          'worklet';
          const padL = hasTrack ? 60 : 4;
          const usable = rowW - padL - 4;
          if (usable <= 0) {
            return;
          }
          let i = Math.floor((e.x - padL) / (usable / TABS.length));
          i = Math.max(0, Math.min(TABS.length - 1, i));
          if (i !== swipeIdx.value) {
            swipeIdx.value = i;
            runOnJS(onSwipeTick)(i);
          }
        })
        .onEnd(() => {
          'worklet';
          if (swipeIdx.value >= 0) {
            runOnJS(commitSwipe)(swipeIdx.value);
          } else {
            runOnJS(cancelSwipe)();
          }
        })
        .onFinalize((_e, success) => {
          'worklet';
          swipeIdx.value = -1;
          // Cancelled gesture (never reached onEnd) — drop the ghost highlight.
          if (!success) {
            runOnJS(cancelSwipe)();
          }
        }),
    [rowW, hasTrack, onSwipeTick, commitSwipe, cancelSwipe, swipeIdx],
  );

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { paddingBottom: insets.bottom + 16 }]}
    >
      <View
        pointerEvents="box-none"
        style={styles.slot}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        {gooActive && width > 0 && (
          <Goo
            variant="subtle"
            style={[
              styles.goo,
              { left: -GOO_PAD, right: -GOO_PAD, top: -GOO_PAD, bottom: -GOO_PAD },
            ]}
          >
            {/* Inset 2px under the chrome: the metaball threshold (σ5 blur →
                alpha boost) inflates edges ~2-3px, and a full-size silhouette
                printed a lighter ghost outline AROUND the pill for the whole
                window (owner crops). The fusion seams stay visible; the
                perimeter hides under the real glass. */}
            <RoundedRect
              x={capSilXIn}
              y={GOO_PAD + 2}
              width={capSilWIn}
              height={48}
              r={radii.dock - 2}
              color={gooFill[name]}
            />
            <Circle
              cx={GOO_PAD + 4 + BEAD_SIZE / 2}
              cy={GOO_PAD + 26}
              r={beadSilR}
              color={gooFill[name]}
            />
            {/* The four tabs as blobs of mass, melting into the contracting
                capsule. Mounted for EVERY goo window, not just while btt is
                set: the exit morph runs after btt has already flipped false,
                and gating on it skipped the reverse un-fusion (the return
                read as a plain widen — owner field report). At rest they sit
                inside the capsule silhouette, invisible. */}
            {TABS.map((tab, i) => (
              <Circle
                key={tab.name}
                cx={itemSilCx[i]}
                cy={GOO_PAD + 26}
                r={15}
                color={gooFill[name]}
              />
            ))}
          </Goo>
        )}
        <Animated.View style={capsuleStyle}>
          {/* blur sleeps automatically while solid (goo windows) — BlurView
              and the Skia layer effect never share a frame. */}
          <Glass radius={radii.dock} solid={gooActive} soft blur style={styles.capsule}>
            <GestureDetector gesture={tabSwipe}>
              <Animated.View
                pointerEvents={btt ? 'none' : 'auto'}
                style={[styles.row, rowStyle, rowMeltStyle]}
                onLayout={(e) => setRowW(e.nativeEvent.layout.width)}
              >
                {TABS.map((tab, i) => {
                  const focused = activeIndex === i;
                  return (
                    <DockTab
                      key={tab.name}
                      route={tab}
                      focused={focused}
                      label={tab.label}
                      tint={focused ? t.accent : t.inkFaint}
                      accent={t.accent}
                      onPress={() => goTab(tab.name)}
                      index={i}
                      bttV={bttV}
                    />
                  );
                })}
              </Animated.View>
            </GestureDetector>
            {/* The pill the dock contracts INTO — web .aura-dock__btt. Fades
                in 80ms behind the melting items so they clear before the
                label lands. */}
            <Animated.View
              pointerEvents={btt ? 'auto' : 'none'}
              style={[styles.btt, bttLabelStyle]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="take me back up"
                onPress={() => toTopRef.current?.()}
                style={styles.bttPress}
              >
                <Icon name="arrow-up" size={14} color={t.ink} />
                <Text style={[styles.bttText, { color: t.ink }]}>
                  Take me back up
                </Text>
              </Pressable>
            </Animated.View>
          </Glass>
        </Animated.View>
        {hasTrack && (
          <Animated.View
            pointerEvents={btt ? 'none' : 'auto'}
            style={[styles.beadSlot, beadRetractStyle, gooActive && styles.hidden]}
          >
            <Bead />
          </Animated.View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    backgroundColor: 'transparent',
  },
  slot: { position: 'relative' },
  goo: { position: 'absolute', zIndex: 1 },
  capsule: { height: 52, justifyContent: 'center' },
  row: { flexDirection: 'row', paddingRight: 4 },
  tab: { flex: 1, justifyContent: 'center' },
  tabInner: { alignItems: 'center', gap: 3, paddingVertical: 6 },
  dot: { position: 'absolute', bottom: -1, width: 4, height: 4, borderRadius: 2 },
  beadSlot: { position: 'absolute', left: 4, top: 0, zIndex: 2 },
  hidden: { opacity: 0 },
  btt: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bttPress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  bttText: { fontFamily: fonts.semibold, fontSize: 13 },
});
