import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Dimensions,
  Image,
  Keyboard,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  Directions,
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { usePlaybackProgress } from '../hooks/usePlaybackProgress';
import { useLikes } from '../hooks/useLikes';
import { useTrackDirection } from '../hooks/useTrackDirection';
import { QUALITIES } from '../lib/audioQuality';
import { getSleepState, subscribeSleep } from '../lib/sleepTimer';
import { openSleepTimer } from '../lib/sleepTimerSheet';
import { openAddToPlaylist } from '../lib/addToPlaylistSheet';
import { openQualitySheet } from '../lib/qualitySheet';
import {
  HINT_LIKE,
  HINT_NEXT,
  HINT_QUEUE_SWIPE,
  markHintDone,
} from '../lib/hints';
import { useHintActive } from '../hooks/useHintActive';
import { showToast } from '../lib/toast';
import { TrackArt } from '../components/TrackRow';
import { ProgressRibbon } from '../components/player/ProgressRibbon';
import { LikeBurst } from '../components/player/HeartButton';
import { TapHeart } from '../components/player/TapHeart';
import { Icon } from '../components/Icon';
import { Glass } from '../components/ui/Glass';
import { GradientBg } from '../components/ui/GradientBg';
import { PressScale } from '../components/ui/PressScale';
import { Skeleton } from '../components/ui/Skeleton';
import { cleanTitle } from '../utils/title';
import { fmtTime } from '../utils/fmtTime';
import { fonts, type, label, radii, elevation } from '../theme/tokens';
import { DUR, EASE, SPRING } from '../theme/motion';

const artUrl = (track, res = 500) =>
  track?.imageUrl ? track.imageUrl.replace(/\d+x\d+/, `${res}x${res}`) : null;

// The physical screen height (constant — unlike useWindowDimensions, it does
// NOT shrink when a keyboard is up). EVERY full-bleed layer of the player
// (backdrop image, stage gradient, scrim gradient) is pre-painted at this
// height, because of a ROM quirk proven on-device: when the player opens over
// a keyboard-short window, the window-resize event never fires after the
// keyboard's inset releases — React never re-renders, so a layer painted at
// the short height stays short forever (native flex re-layout grows the
// CONTENT, but rn-svg 100%-rects and pixel-sized images keep their mount-time
// paint). Pre-painting at screen height means the covered strip is simply
// revealed as the root grows — no repaint needed. Field history: the winH-tall
// backdrop left a pale strip where the keyboard was; sizing only the backdrop
// to SCREEN_H then inverted it into a dark strip of unscrimmed art.
const SCREEN_H = Dimensions.get('screen').height;

// Track-change transition — the web's "develop into focus" made directional.
// Forward travel flows like a filmstrip: the new art glides in from the right
// while it sharpens (its blurred twin fading off it) and the old art slips
// out to the left; backward is the mirror. A directionless change (a fresh
// set) keeps the plain centered crossfade. All motion is shared values on
// mounted layers — never an exiting layout animation, which aborts natively
// when the sheet unmounts mid-flight.
function ArtDevelop({ track, dir, size, reduced }) {
  const [old, setOld] = useState(null);
  const prev = useRef(track);
  const p = useSharedValue(1);
  const d = useSharedValue(0);
  const timer = useRef(null);

  useEffect(() => {
    if (track.id === prev.current.id) {
      return;
    }
    const outgoing = prev.current;
    prev.current = track;
    if (reduced) {
      return;
    }
    const ms = dir === 0 ? DUR.crossfade : DUR.travel;
    d.value = dir;
    setOld(outgoing);
    p.value = 0;
    p.value = withTiming(1, { duration: ms, easing: EASE.enter });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOld(null), ms + 40);
  }, [track, dir, reduced, p, d]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const oldStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.6, 1], [1, 0, 0]),
    transform: [{ translateX: -p.value * d.value * size * 0.3 }],
  }));
  const curStyle = useAnimatedStyle(() => ({
    opacity:
      d.value === 0 ? p.value : interpolate(p.value, [0, 0.65, 1], [0, 1, 1]),
    transform: [
      { translateX: (1 - p.value) * d.value * size * 0.36 },
      { scale: 0.97 + 0.03 * p.value },
    ],
  }));
  const twinStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.55, 1], [1, 0.7, 0]),
  }));

  const url = artUrl(track);
  return (
    <View style={{ width: size, height: size }}>
      {old && (
        <Animated.View style={[StyleSheet.absoluteFill, oldStyle]}>
          <TrackArt
            track={old}
            size={size}
            radius={radii.playerArt}
            res={500}
          />
        </Animated.View>
      )}
      <Animated.View
        style={[StyleSheet.absoluteFill, elevation.art, curStyle]}
      >
        <TrackArt
          track={track}
          size={size}
          radius={radii.playerArt}
          res={500}
        />
        {old && url && (
          <Animated.Image
            source={{ uri: url }}
            blurRadius={8}
            style={[
              styles.twin,
              { width: size, height: size, borderRadius: radii.playerArt },
              twinStyle,
            ]}
          />
        )}
      </Animated.View>
    </View>
  );
}

// One line of the track meta gliding in from the direction of travel — the
// artist follows the title a beat later (the stagger). Directionless changes
// just fade in place.
function MetaGlide({ id, dir, delay = 0, reduced, children }) {
  const m = useSharedValue(1);
  const d = useSharedValue(0);
  const prev = useRef(id);
  useEffect(() => {
    if (id === prev.current) {
      return;
    }
    prev.current = id;
    if (reduced) {
      return;
    }
    d.value = dir;
    m.value = 0;
    m.value = withDelay(
      delay,
      withTiming(1, { duration: DUR.upNext, easing: EASE.enter }),
    );
  }, [id, dir, delay, reduced, m, d]);
  const s = useAnimatedStyle(() => ({
    opacity: m.value,
    transform: [{ translateX: (1 - m.value) * d.value * 26 }],
  }));
  return <Animated.View style={s}>{children}</Animated.View>;
}

// A gentle side-to-side bob on the swipe-hint arrow — the motion suggests the
// horizontal swipe it's teaching.
function HintFloat({ reduced, children }) {
  const v = useSharedValue(0);
  useEffect(() => {
    if (reduced) {
      return undefined;
    }
    v.value = withRepeat(
      withSequence(
        withTiming(-3, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        withTiming(3, { duration: 600, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      true,
    );
    return () => cancelAnimation(v);
  }, [reduced, v]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: v.value }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

// A gentle upward bob for the "swipe up" queue hint.
function HintFloatUp({ reduced, children }) {
  const v = useSharedValue(0);
  useEffect(() => {
    if (reduced) {
      return undefined;
    }
    v.value = withRepeat(
      withSequence(
        withTiming(-4, { duration: 700, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
    );
    return () => cancelAnimation(v);
  }, [reduced, v]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: v.value }, { rotate: '180deg' }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

// Full-screen now-playing sheet. Slides up from the bottom edge like a native
// bottom sheet (the backdrop art develops in once the slide lands), closes by
// the reverse or by a drag-follow pull down. Mount inside NavigationContainer
// (sibling of RootTabs).
export function PlayerSheet() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const player = usePlayer();
  const { position, duration } = usePlaybackProgress();
  const reduced = useReducedMotion();
  const { isLiked, like, unlike } = useLikes();

  const track = player.current;
  const open = player.ui?.playerOpen ?? false;
  // Filmstrip direction for this change — feeds the art glide, the meta
  // stagger and the backdrop parallax below.
  const dir = useTrackDirection(player.queue);

  // 'closed' | 'open' | 'closing'
  const [vis, setVis] = useState('closed');
  const [heroH, setHeroH] = useState(0);
  // Where the last double-tap landed — drives the heart pop at that spot.
  const [burst, setBurst] = useState(null);
  // In-place gesture hints: each stays until its gesture is performed once.
  const likeHint = useHintActive(HINT_LIKE);
  const nextHint = useHintActive(HINT_NEXT);
  const queueHint = useHintActive(HINT_QUEUE_SWIPE);

  const slide = useSharedValue(winH);
  const dragY = useSharedValue(0);
  const backdropFade = useSharedValue(0);
  const breathe = useSharedValue(0.85);
  // Filmstrip parallax: on a directional change the blurred backdrop takes a
  // small step with the travel and settles, lagging the art's bigger move —
  // depth, not decoration. Its 1.3 paint scale leaves it slack to slide in.
  const bdPan = useSharedValue(0);
  const bdPrev = useRef(track?.id);
  useEffect(() => {
    if (!track || track.id === bdPrev.current) {
      return;
    }
    bdPrev.current = track.id;
    if (reduced || dir === 0) {
      return;
    }
    bdPan.value = dir * 18;
    bdPan.value = withTiming(0, {
      duration: DUR.crossfade,
      easing: EASE.enter,
    });
  }, [track, dir, reduced, bdPan]);
  const bdPanStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: bdPan.value }],
  }));

  const endClose = useCallback(() => setVis('closed'), []);

  useEffect(() => {
    if (open && vis === 'closed') {
      // The search keyboard would otherwise stay up and squeeze the sheet.
      Keyboard.dismiss();
      dragY.value = 0;
      if (reduced) {
        slide.value = 0;
        backdropFade.value = 1;
      } else {
        slide.value = winH;
        slide.value = withSpring(0, SPRING.sheet);
        backdropFade.value = 0;
        backdropFade.value = withTiming(1, {
          duration: DUR.screen,
          easing: EASE.enter,
        });
      }
      setVis('open');
    }
    // Closed from outside the sheet (sign-out) — resync the mount machine so
    // the next open still gets its slide-in.
    if (!open && vis === 'open') {
      setVis('closed');
    }
  }, [open, vis, reduced, winH, slide, dragY, backdropFade]);

  // closePlayer flips the context state immediately (screens react at once);
  // the sheet itself stays mounted through vis='closing' while the exit runs.
  const close = useCallback(() => {
    if (vis === 'closing') {
      return;
    }
    setVis('closing');
    player.ui?.closePlayer?.();
    if (reduced) {
      endClose();
      return;
    }
    slide.value = withTiming(
      winH,
      { duration: DUR.sheetOut, easing: EASE.exit },
      done => {
        if (done) {
          runOnJS(endClose)();
        }
      },
    );
  }, [vis, reduced, endClose, player.ui, winH, slide]);

  // Armed sleep timer tints the moon in the actions row.
  const [sleep, setSleep] = useState(getSleepState);
  useEffect(() => subscribeSleep(setSleep), []);

  // Hardware back closes the player instead of popping the navigator under
  // it. Sheets stacked above register later, so they win first (LIFO).
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [open, close]);

  // Breathing accent glow behind the play button, playing only (web aura-breathe).
  // Gated on `open` as well: the sheet stays mounted for the whole session, so
  // without it this infinite animation keeps ticking the UI thread behind a
  // closed player — including screen-off playback, where nothing renders it.
  const playing = player.isPlaying;
  useEffect(() => {
    if (playing && open && !reduced) {
      breathe.value = withRepeat(
        withTiming(1.08, {
          duration: DUR.breathe / 2,
          easing: Easing.inOut(Easing.sin),
        }),
        -1,
        true,
      );
      return () => cancelAnimation(breathe);
    }
    breathe.value = withTiming(0.85, { duration: 300 });
    return undefined;
  }, [playing, open, reduced, breathe]);

  // Drag-follow dismiss. On commit the shared close() runs — its slide-out
  // starts from wherever the drag left the sheet (the transforms sum), so the
  // motion continues downward without a jump.
  const closeOnJS = close;
  const dismissPan = Gesture.Pan()
    .activeOffsetY(24)
    .onUpdate(e => {
      'worklet';
      dragY.value = Math.max(0, e.translationY);
    })
    .onEnd(e => {
      'worklet';
      if (e.velocityY > 900 || dragY.value > winH * 0.28) {
        runOnJS(closeOnJS)();
      } else {
        dragY.value = withSpring(0, SPRING.snapback);
      }
    });

  const sheetStyle = useAnimatedStyle(() => {
    const p = Math.min(1, dragY.value / (winH * 0.5));
    return {
      transform: [
        { translateY: slide.value + dragY.value },
        { scale: 1 - p * 0.04 },
      ],
      borderRadius: p * radii.sheet,
    };
  });
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropFade.value,
  }));
  const breatheStyle = useAnimatedStyle(() => ({
    opacity: playing ? 0.35 : 0,
    transform: [{ scale: breathe.value }],
  }));

  if ((!open && vis !== 'closing') || !track) {
    return null;
  }

  const queue = player.queue ?? { tracks: [], idx: -1, source: null };
  const queuedNext = queue.tracks[queue.idx + 1] ?? null;
  // On the last track nothing follows IN the queue — auto-radio is what plays
  // next, so show its prefetched pick, or that we're still finding it. Web
  // (App.jsx) feeds MobilePlayer the same two values from autoNextDisplay /
  // autoNextLoading; without them the slot just goes blank at the queue end.
  const auto = player.autoNext;
  const nextTrack = queuedNext ?? player.autoNextTracks?.[0] ?? null;
  const findingNext =
    !nextTrack && !!auto?.loading && auto.seedId === track?.id;
  // Cap the art by the hero row's real height too — with the keyboard up (or
  // any squeezed window) a width-only size overflows onto the title below.
  const artSize = Math.min(
    winW - 72,
    360,
    heroH > 0 ? heroH - 16 : Number.MAX_SAFE_INTEGER,
  );
  // 150px source for the backdrop: it's blurred to a color wash anyway, and
  // the blur runs on the decoded bitmap — 150² is ~11× less memory and blur
  // work than 500². Radius scales with the bitmap, so 14/150 ≈ the old 48/500.
  const backdrop = artUrl(track, 150);
  const liked = isLiked(track.id);
  const likeNow = () => {
    showToast('liked.');
    like(track.id).catch(() => showToast("couldn't like — try again."));
  };
  const toggleLike = () => {
    if (liked) {
      showToast('removed from likes.');
      unlike(track.id).catch(() => showToast("couldn't like — try again."));
    } else {
      likeNow();
    }
  };

  // Art gestures. Double-tap always LIKES (the Instagram convention — a
  // celebration, not a toggle; silently idempotent when already liked), and
  // the heart pops right where the fingers landed. Swipe LEFT = next, RIGHT =
  // prev (the record-flip metaphor). Horizontal flings can't collide with the
  // sheet's drag-dismiss (downward) or the queue swipe (upward). All discrete,
  // so they run straight on the JS thread. Performing a swipe retires its hint.
  const artDoubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .runOnJS(true)
    .onEnd((e, success) => {
      if (success) {
        markHintDone(HINT_LIKE);
        setBurst(b => ({ x: e.x, y: e.y, key: (b?.key ?? 0) + 1 }));
        if (!liked) {
          likeNow();
        }
      }
    });
  const artFlingNext = Gesture.Fling()
    .direction(Directions.LEFT)
    .runOnJS(true)
    .onEnd((_e, success) => {
      if (success) {
        markHintDone(HINT_NEXT);
        player.next();
      }
    });
  const artFlingPrev = Gesture.Fling()
    .direction(Directions.RIGHT)
    .runOnJS(true)
    .onEnd((_e, success) => {
      if (success) {
        markHintDone(HINT_NEXT);
        player.prev();
      }
    });
  const artGestures = Gesture.Race(artFlingNext, artFlingPrev, artDoubleTap);

  // Swipe UP to open the queue — bound to the UP-NEXT area (its own detector),
  // not the art. On the art it fought the left/right flings; over the up-next
  // slot it's a separate region, so it coexists cleanly and lands exactly
  // where the user reaches ("pull the queue up from the bottom").
  const queueFling = Gesture.Fling()
    .direction(Directions.UP)
    .runOnJS(true)
    .onEnd((_e, success) => {
      if (success) {
        markHintDone(HINT_QUEUE_SWIPE);
        player.ui?.openQueue?.();
      }
    });
  const qualityLabel =
    QUALITIES.find(q => q.id === player.quality)?.label ?? 'quality';

  // The queue opens as its own sheet above this one — the player stays put
  // and is exactly where you left it when the queue closes.
  const openQueue = () => {
    player.ui?.openQueue?.();
  };

  // One slot, three states: the next song, the placeholder while auto-radio
  // finds one, or a reserved gap. The placeholder is the same box as the pill
  // so the swap to the real thing shifts nothing (web reserves it likewise).
  // Deliberately NO entering animation here (web animates the rise): under
  // auto-radio the slot flips state around every track boundary, and
  // reanimated 4.2.3/Fabric can abort natively when a view is unmounted while
  // its entering animation is in flight — a field-reported crash class on
  // this device (native death, so the JS crash card never writes).
  const upNextSlot = () => {
    if (nextTrack) {
      return (
        <PressScale
          accessibilityRole="button"
          accessibilityLabel="up next, open queue"
          onPress={openQueue}
        >
          <Glass radius={radii.pill} style={styles.upNext}>
            <View style={styles.upNextRow}>
              <TrackArt track={nextTrack} size={28} radius={5} />
              <View style={styles.upNextMeta}>
                <Text style={[label(7.5), { color: t.inkFaint }]}>up next</Text>
                <Text
                  numberOfLines={1}
                  style={[styles.upNextTitle, { color: t.ink }]}
                >
                  {cleanTitle(nextTrack.title)}
                </Text>
              </View>
              <View style={styles.chevRight}>
                <Icon name="chevron-down" size={16} color={t.inkFaint} />
              </View>
            </View>
          </Glass>
        </PressScale>
      );
    }
    if (findingNext) {
      return (
        <View accessible accessibilityLabel="finding next song">
          <Glass radius={radii.pill} style={styles.upNext}>
            <View style={styles.upNextRow}>
              <Skeleton height={28} radius={5} style={styles.skelArt} />
              <View style={styles.upNextMeta}>
                <Text style={[label(7.5), { color: t.inkFaint }]}>up next</Text>
                <Text
                  numberOfLines={1}
                  style={[styles.upNextTitle, { color: t.inkFaint }]}
                >
                  finding next song…
                </Text>
              </View>
            </View>
          </Glass>
        </View>
      );
    }
    return <View style={styles.upNextSpacer} />;
  };

  return (
    <Animated.View
      style={[styles.root, { backgroundColor: t.pageBg }, sheetStyle]}
    >
      <GestureDetector gesture={dismissPan}>
        <View style={styles.fill}>
          <GradientBg
            style={styles.bleed}
            stops={[
              { offset: 0, color: t.stageBgStart },
              { offset: 1, color: t.stageBgEnd },
            ]}
          />
          {backdrop && (
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, backdropStyle]}
            >
              <Animated.View style={[StyleSheet.absoluteFill, bdPanStyle]}>
                <Image
                  source={{ uri: backdrop }}
                  blurRadius={14}
                  style={[
                    styles.backdrop,
                    { width: winW, height: Math.max(winH, SCREEN_H) },
                  ]}
                />
              </Animated.View>
            </Animated.View>
          )}
          <GradientBg
            style={styles.bleed}
            angle={180}
            stops={[
              { offset: 0, color: t.bg, opacity: 0.72 },
              { offset: 0.26, color: t.bg, opacity: 0.42 },
              { offset: 0.5, color: t.bg, opacity: 0.48 },
              { offset: 0.96, color: t.bg, opacity: 1 },
            ]}
          />

          <View
            style={[
              styles.content,
              {
                paddingTop: insets.top + 10,
                paddingBottom: insets.bottom + 18,
              },
            ]}
          >
            <View style={styles.top}>
              <PressScale
                accessibilityRole="button"
                accessibilityLabel="close player"
                onPress={close}
                hitSlop={10}
              >
                <Glass radius={19} style={styles.chip}>
                  <Icon name="chevron-down" size={22} color={t.ink} />
                </Glass>
              </PressScale>
              {/* Centered source title — balanced by an empty chip-sized view
                  on the right so it sits dead-centre (field report). */}
              <Text
                numberOfLines={1}
                style={[label(11), styles.topSource, { color: t.inkFaint }]}
              >
                {queue.source ?? 'now playing'}
              </Text>
              <View style={styles.chip} />
            </View>

            <GestureDetector gesture={artGestures}>
              <View
                style={styles.hero}
                onLayout={e => setHeroH(e.nativeEvent.layout.height)}
              >
                <ArtDevelop
                  track={track}
                  dir={dir}
                  size={artSize}
                  reduced={reduced}
                />
                <TapHeart burst={burst} accent={t.accent} />
                {/* Gesture hints, shown where the gestures live — each one
                    stays until the user has actually performed it once. */}
                {(likeHint || nextHint) && (
                  <View pointerEvents="none" style={styles.hintStack}>
                    {likeHint && (
                      <View
                        style={[
                          styles.hintChip,
                          { backgroundColor: t.accentCard },
                        ]}
                      >
                        <Icon name="heart" size={13} color={t.accent} />
                        <Text style={[styles.hintText, { color: t.ink }]}>
                          double-tap to like
                        </Text>
                      </View>
                    )}
                    {nextHint && (
                      <View
                        style={[
                          styles.hintChip,
                          { backgroundColor: t.accentCard },
                        ]}
                      >
                        <HintFloat reduced={reduced}>
                          <Icon
                            name="arrow-right"
                            size={13}
                            color={t.accent}
                          />
                        </HintFloat>
                        <Text style={[styles.hintText, { color: t.ink }]}>
                          swipe left for next, right for back
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            </GestureDetector>

            <View style={styles.meta}>
              <MetaGlide id={track.id} dir={dir} reduced={reduced}>
                <Text
                  numberOfLines={2}
                  style={[type.playerTitle, styles.center, { color: t.ink }]}
                >
                  {cleanTitle(track.title)}
                </Text>
              </MetaGlide>
              {!!track.artist && (
                <MetaGlide id={track.id} dir={dir} delay={70} reduced={reduced}>
                  <Text
                    numberOfLines={1}
                    style={[type.body, styles.center, { color: t.inkSoft }]}
                  >
                    {track.artist}
                  </Text>
                </MetaGlide>
              )}
            </View>

            <ProgressRibbon
              progress={duration > 0 ? position / duration : 0}
              playing={player.isPlaying}
              seed={String(track.id ?? 'x')}
              accent={t.accent}
              dim={t.ink}
              height={56}
              onSeek={p => player.seekTo(p * duration)}
            />
            <View style={styles.timeRow}>
              <Text style={[type.time, { color: t.inkFaint }]}>
                {fmtTime(position)}
              </Text>
              <Text style={[type.time, { color: t.inkFaint }]}>
                -{fmtTime(Math.max(0, duration - position))}
              </Text>
            </View>

            <View style={styles.transport}>
              <PressScale
                accessibilityRole="button"
                accessibilityLabel="previous"
                onPress={player.prev}
                hitSlop={10}
                style={styles.navBtn}
              >
                <Icon name="prev" size={30} color={t.ink} />
              </PressScale>
              <View style={styles.playWrap}>
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.playGlow,
                    { backgroundColor: t.accent },
                    breatheStyle,
                  ]}
                />
                <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={player.isPlaying ? 'pause' : 'play'}
                  onPress={player.togglePlay}
                  style={[
                    styles.playBtn,
                    { backgroundColor: t.accent },
                    elevation.accentGlow(t.accent),
                  ]}
                >
                  <Icon
                    name={player.isPlaying ? 'pause' : 'play'}
                    size={30}
                    color={t.surface}
                  />
                </PressScale>
              </View>
              <PressScale
                accessibilityRole="button"
                accessibilityLabel="next"
                onPress={player.next}
                hitSlop={10}
                style={styles.navBtn}
              >
                <Icon name="next" size={30} color={t.ink} />
              </PressScale>
            </View>

            {/* Playback modifiers — small icons + a single quality pill that
                opens the quality picker (was a messy row of 3 quality chips). */}
            <View style={styles.modifiers}>
              <PressScale
                accessibilityRole="button"
                accessibilityLabel={
                  player.shuffleActive ? 'shuffle off' : 'shuffle'
                }
                onPress={player.toggleShuffle}
                hitSlop={8}
              >
                <Icon
                  name="shuffle"
                  size={20}
                  color={player.shuffleActive ? t.accent : t.inkFaint}
                />
              </PressScale>
              <PressScale
                accessibilityRole="button"
                accessibilityLabel={`repeat ${player.repeat}`}
                onPress={player.cycleRepeat}
                hitSlop={8}
              >
                <Icon
                  name={player.repeat === 'one' ? 'repeat-one' : 'repeat'}
                  size={20}
                  color={player.repeat !== 'off' ? t.accent : t.inkFaint}
                />
              </PressScale>
              <PressScale
                accessibilityRole="button"
                accessibilityLabel="sleep timer"
                onPress={openSleepTimer}
                hitSlop={8}
              >
                <Icon
                  name="moon"
                  size={19}
                  color={sleep ? t.accent : t.inkFaint}
                />
              </PressScale>
              <PressScale
                accessibilityRole="button"
                accessibilityLabel="lyrics"
                onPress={() => player.ui?.openLyrics?.()}
                hitSlop={8}
              >
                <Icon name="lyrics" size={19} color={t.inkFaint} />
              </PressScale>
              <PressScale
                accessibilityRole="button"
                accessibilityLabel={`audio quality, ${qualityLabel}`}
                onPress={openQualitySheet}
                style={[styles.qualityPill, { borderColor: t.line }]}
              >
                <Icon name="quality" size={15} color={t.inkSoft} />
                <Text style={[label(10), { color: t.inkSoft }]}>
                  {qualityLabel}
                </Text>
              </PressScale>
            </View>

            {/* Save actions — prominent and near the bottom (field report). */}
            <View style={styles.saveRow}>
              <PressScale
                accessibilityRole="button"
                accessibilityLabel={liked ? 'unlike' : 'like'}
                onPress={toggleLike}
                style={[
                  styles.saveBtn,
                  { borderColor: liked ? t.accent : t.line },
                  liked && { backgroundColor: t.accentSoft },
                ]}
              >
                <LikeBurst liked={liked} accent={t.accent} size={19}>
                  <Icon
                    name={liked ? 'heart-filled' : 'heart'}
                    size={19}
                    color={liked ? t.accent : t.ink}
                    strokeWidth={1.7}
                  />
                </LikeBurst>
                <Text
                  style={[styles.saveText, { color: liked ? t.accent : t.ink }]}
                >
                  {liked ? 'liked' : 'like'}
                </Text>
              </PressScale>
              <PressScale
                accessibilityRole="button"
                accessibilityLabel="add to playlist"
                onPress={() => openAddToPlaylist(track)}
                style={[styles.saveBtn, { borderColor: t.line }]}
              >
                <Icon name="plus" size={19} color={t.ink} />
                <Text style={[styles.saveText, { color: t.ink }]}>
                  add to playlist
                </Text>
              </PressScale>
            </View>

            {/* Swipe up anywhere on this bottom band (hint + up-next) opens the
                queue — where the user reaches for it. */}
            <GestureDetector gesture={queueFling}>
              <View>
                {/* Until the user has flicked up once, a quiet nudge sits here. */}
                {queueHint && (
                  <View pointerEvents="none" style={styles.queueHintRow}>
                    <HintFloatUp reduced={reduced}>
                      <Icon name="chevron-down" size={13} color={t.accent} />
                    </HintFloatUp>
                    <Text
                      style={[styles.queueHintText, { color: t.inkSoft }]}
                    >
                      swipe up to open the queue
                    </Text>
                  </View>
                )}
                {upNextSlot()}
              </View>
            </GestureDetector>
          </View>
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    // zIndex only — elevation outranks sibling order on this device, which
    // buried the action sheets (field report). Overlay ladder: player 30,
    // queue 40, action sheets 50.
    zIndex: 30,
    overflow: 'hidden',
  },
  fill: { flex: 1 },
  // Full-bleed layer pinned to PHYSICAL screen height (see SCREEN_H): painted
  // in full at mount even inside a keyboard-short window, then revealed as the
  // root grows — the explicit height overrides absoluteFill's bottom edge.
  bleed: { height: SCREEN_H },
  backdrop: {
    position: 'absolute',
    opacity: 0.9,
    transform: [{ scale: 1.3 }],
  },
  content: { flex: 1, paddingHorizontal: 24 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chip: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topSource: { flex: 1, textAlign: 'center' },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  hintStack: {
    position: 'absolute',
    bottom: 6,
    alignSelf: 'center',
    alignItems: 'center',
    gap: 6,
  },
  hintChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  hintText: { fontFamily: fonts.medium, fontSize: 11.5 },
  twin: { position: 'absolute', left: 0, top: 0 },
  meta: { gap: 4, marginBottom: 10 },
  center: { textAlign: 'center' },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    marginTop: 8,
  },
  navBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playWrap: { alignItems: 'center', justifyContent: 'center' },
  playGlow: {
    position: 'absolute',
    width: 92,
    height: 92,
    borderRadius: 46,
  },
  playBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modifiers: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingHorizontal: 4,
  },
  qualityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  saveRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  saveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 13,
  },
  saveText: { fontFamily: fonts.medium, fontSize: 14 },
  upNext: { marginTop: 16 },
  upNextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  upNextMeta: { flex: 1, gap: 1 },
  upNextTitle: { fontFamily: 'HankenGrotesk-Medium', fontSize: 13.5 },
  // Stands in for the 28px TrackArt while auto-radio resolves the next song.
  skelArt: { width: 28 },
  chevRight: { transform: [{ rotate: '-90deg' }] },
  upNextSpacer: { height: 44, marginTop: 16 },
  queueHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
    marginBottom: -6,
  },
  queueHintText: { fontFamily: fonts.medium, fontSize: 11.5 },
});
