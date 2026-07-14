import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainerRefContext } from '@react-navigation/native';
import Animated, {
  Easing,
  Keyframe,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { usePlaybackProgress } from '../hooks/usePlaybackProgress';
import { QUALITIES } from '../lib/audioQuality';
import { TrackArt } from '../components/TrackRow';
import { ProgressRibbon } from '../components/player/ProgressRibbon';
import { Icon } from '../components/Icon';
import { Glass } from '../components/ui/Glass';
import { GradientBg } from '../components/ui/GradientBg';
import { PressScale } from '../components/ui/PressScale';
import { cleanTitle } from '../utils/title';
import { fmtTime } from '../utils/fmtTime';
import { type, label, radii, elevation } from '../theme/tokens';
import { DUR, EASE, SPRING } from '../theme/motion';

const BEAD = 52;

// Web aura-mp-upnext-in: rise + settle, 340ms.
const upNextEnter = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 12 }, { scale: 0.985 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
}).duration(DUR.upNext);

const artUrl = (track, res = 500) =>
  track?.imageUrl ? track.imageUrl.replace(/\d+x\d+/, `${res}x${res}`) : null;

// Track-change crossfade, the web's "develop into focus": the new art arrives
// blurred and sharpens while the old one fades underneath (900ms total).
function ArtDevelop({ track, size }) {
  const [twin, setTwin] = useState(null);
  const prevId = useRef(track.id);

  useEffect(() => {
    if (track.id !== prevId.current) {
      prevId.current = track.id;
      setTwin(track.id);
      const id = setTimeout(() => setTwin(null), DUR.crossfade);
      return () => clearTimeout(id);
    }
  }, [track.id]);

  const url = artUrl(track);
  return (
    <View style={{ width: size, height: size }}>
      <View key={track.id} style={[StyleSheet.absoluteFill, elevation.art]}>
        <TrackArt track={track} size={size} radius={radii.playerArt} res={500} />
      </View>
      {twin && url && (
        <Image
          source={{ uri: url }}
          blurRadius={8}
          style={[styles.twin, { width: size, height: size, borderRadius: radii.playerArt }]}
        />
      )}
    </View>
  );
}

// Full-screen now-playing sheet. Opens by blooming out of the dock bead (clip
// circle scale + shared-element art flight), closes by the reverse or by a
// drag-follow pull down. Mount inside NavigationContainer (sibling of RootTabs).
export function PlayerSheet() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const player = usePlayer();
  const { position, duration } = usePlaybackProgress();
  const reduced = useReducedMotion();
  const navRoot = useContext(NavigationContainerRefContext);

  const track = player.current;
  const open = player.ui?.playerOpen ?? false;

  // 'closed' | 'entering' | 'open' | 'closing'
  const [vis, setVis] = useState('closed');
  const [heroRect, setHeroRect] = useState(null);
  const heroRef = useRef(null);

  // Morph geometry from the bead's window rect (dock-center fallback).
  const origin = player.ui?.origin?.current ?? null;
  const ocx = origin ? origin.x + origin.width / 2 : winW / 2;
  const ocy = origin ? origin.y + origin.height / 2 : winH - 90;
  const R = Math.max(
    Math.hypot(ocx, ocy),
    Math.hypot(winW - ocx, ocy),
    Math.hypot(ocx, winH - ocy),
    Math.hypot(winW - ocx, winH - ocy),
  );
  const D = Math.ceil(R * 2) + 2;
  const s0 = BEAD / D;

  const bloom = useSharedValue(0);
  const fade = useSharedValue(0);
  const flight = useSharedValue(0);
  const flightBlur = useSharedValue(1);
  const dragY = useSharedValue(0);
  const breathe = useSharedValue(0.85);

  const endClose = useCallback(() => {
    setVis('closed');
    setHeroRect(null);
  }, []);

  // Open: render invisibly, measure the hero, then bloom.
  useEffect(() => {
    if (open && vis === 'closed') {
      bloom.value = 0;
      fade.value = 0;
      flight.value = 0;
      flightBlur.value = 1;
      dragY.value = 0;
      setVis('entering');
    }
  }, [open, vis, bloom, fade, flight, flightBlur, dragY]);

  const beginBloom = useCallback(() => {
    if (reduced) {
      bloom.value = 1;
      fade.value = 1;
      flight.value = 1;
      flightBlur.value = 0;
      setVis('open');
      return;
    }
    fade.value = withTiming(1, { duration: 240, easing: EASE.enter });
    bloom.value = withSpring(1, SPRING.bloom);
    flight.value = withSpring(1, SPRING.bloom);
    flightBlur.value = withDelay(
      DUR.bloom - 120,
      withTiming(0, { duration: 420, easing: EASE.exit }),
    );
    setVis('open');
  }, [reduced, bloom, fade, flight, flightBlur]);

  const onHeroLayout = useCallback(() => {
    if (vis !== 'entering') {
      return;
    }
    const el = heroRef.current;
    if (el?.measureInWindow) {
      el.measureInWindow((x, y, width, height) => {
        setHeroRect({ x, y, width, height });
        beginBloom();
      });
    } else {
      beginBloom();
    }
  }, [vis, beginBloom]);

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
    flightBlur.value = 0;
    flight.value = withTiming(0, { duration: DUR.bloom, easing: EASE.exit });
    fade.value = withDelay(120, withTiming(0, { duration: 340, easing: EASE.exit }));
    bloom.value = withTiming(0, { duration: DUR.bloom, easing: EASE.exit }, (done) => {
      if (done) {
        runOnJS(endClose)();
      }
    });
  }, [vis, reduced, endClose, player.ui, bloom, fade, flight, flightBlur]);

  // Breathing accent glow behind the play button, playing only (web aura-breathe).
  const playing = player.isPlaying;
  useEffect(() => {
    if (playing && !reduced) {
      breathe.value = withRepeat(
        withTiming(1.08, { duration: DUR.breathe / 2, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      );
    } else {
      breathe.value = withTiming(0.85, { duration: 300 });
    }
  }, [playing, reduced, breathe]);

  // Drag-follow dismiss.
  const closeOnJS = close;
  const dismissPan = Gesture.Pan()
    .activeOffsetY(24)
    .onUpdate((e) => {
      'worklet';
      dragY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      'worklet';
      if (e.velocityY > 900 || dragY.value > winH * 0.28) {
        dragY.value = withTiming(winH * 0.4, { duration: 260, easing: EASE.exit });
        runOnJS(closeOnJS)();
      } else {
        dragY.value = withSpring(0, SPRING.snapback);
      }
    });

  const rootStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(bloom.value, [0, 1], [s0, 1]) }],
  }));
  const contentCounterStyle = useAnimatedStyle(() => {
    const s = interpolate(bloom.value, [0, 1], [s0, 1]);
    return { transform: [{ scale: 1 / s }] };
  });
  const dragStyle = useAnimatedStyle(() => {
    const p = Math.min(1, dragY.value / (winH * 0.5));
    return {
      transform: [{ translateY: dragY.value }, { scale: 1 - p * 0.04 }],
      borderRadius: p * radii.sheet,
    };
  });
  const breatheStyle = useAnimatedStyle(() => ({
    opacity: playing ? 0.35 : 0,
    transform: [{ scale: breathe.value }],
  }));

  // Shared-element art flight: bead rect → hero rect.
  const showFlight = !!(origin && heroRect) && vis !== 'closed';
  const flightStyle = useAnimatedStyle(() => {
    if (!origin || !heroRect) {
      return { opacity: 0 };
    }
    const p = flight.value;
    return {
      opacity: p > 0.02 && flightBlur.value > 0.02 ? 1 : 0,
      left: interpolate(p, [0, 1], [origin.x, heroRect.x]),
      top: interpolate(p, [0, 1], [origin.y, heroRect.y]),
      width: interpolate(p, [0, 1], [origin.width, heroRect.width]),
      height: interpolate(p, [0, 1], [origin.height, heroRect.height]),
      borderRadius: interpolate(p, [0, 1], [BEAD / 2, radii.playerArt]),
    };
  });
  const heroHideStyle = useAnimatedStyle(() => ({
    opacity: showFlight && flightBlur.value > 0.02 ? 0 : 1,
  }));

  if ((!open && vis !== 'closing') || !track) {
    return null;
  }

  const queue = player.queue ?? { tracks: [], idx: -1, source: null };
  const nextTrack = queue.tracks[queue.idx + 1] ?? null;
  const artSize = Math.min(winW - 72, 360);
  const backdrop = artUrl(track);

  const openQueue = () => {
    close();
    if (navRoot?.isReady?.()) {
      navRoot.navigate('Queue');
    }
  };

  return (
    <Animated.View style={[styles.root, rootStyle, dragStyle]}>
      <GestureDetector gesture={dismissPan}>
        <View style={styles.fill}>
          <Animated.View
            style={[
              styles.circle,
              {
                width: D,
                height: D,
                borderRadius: D / 2,
                left: ocx - D / 2,
                top: ocy - D / 2,
              },
              circleStyle,
            ]}
          >
            <Animated.View
              style={[
                styles.stage,
                {
                  width: winW,
                  height: winH,
                  left: D / 2 - ocx,
                  top: D / 2 - ocy,
                  transformOrigin: `${ocx}px ${ocy}px`,
                  backgroundColor: t.pageBg,
                },
                contentCounterStyle,
              ]}
            >
              <GradientBg
                stops={[
                  { offset: 0, color: t.stageBgStart },
                  { offset: 1, color: t.stageBgEnd },
                ]}
              />
              {backdrop && (
                <Image
                  source={{ uri: backdrop }}
                  blurRadius={48}
                  style={[styles.backdrop, { width: winW, height: winH }]}
                />
              )}
              <GradientBg
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
                  { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 18 },
                ]}
              >
                <View style={styles.top}>
                  <PressScale
                    accessibilityRole="button"
                    accessibilityLabel="close player"
                    onPress={close}
                    hitSlop={10}
                  >
                    <Glass radius={19} style={styles.chip} elevated={false}>
                      <Icon name="chevron-down" size={22} color={t.ink} />
                    </Glass>
                  </PressScale>
                  <Text style={[label(11), { color: t.inkFaint }]}>
                    {queue.source ?? 'now playing'}
                  </Text>
                  <View style={styles.chipSpacer} />
                </View>

                <View style={styles.hero}>
                  <Animated.View ref={heroRef} onLayout={onHeroLayout} style={heroHideStyle}>
                    <ArtDevelop track={track} size={artSize} />
                  </Animated.View>
                </View>

                <View style={styles.meta}>
                  <Text numberOfLines={2} style={[type.playerTitle, styles.center, { color: t.ink }]}>
                    {cleanTitle(track.title)}
                  </Text>
                  {!!track.artist && (
                    <Text
                      numberOfLines={1}
                      style={[type.body, styles.center, { color: t.inkSoft }]}
                    >
                      {track.artist}
                    </Text>
                  )}
                </View>

                <ProgressRibbon
                  progress={duration > 0 ? position / duration : 0}
                  playing={player.isPlaying}
                  seed={String(track.id ?? 'x')}
                  accent={t.accent}
                  dim={t.line}
                  height={56}
                  onSeek={(p) => player.seekTo(p * duration)}
                />
                <View style={styles.timeRow}>
                  <Text style={[type.time, { color: t.inkFaint }]}>{fmtTime(position)}</Text>
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
                      style={[styles.playGlow, { backgroundColor: t.accent }, breatheStyle]}
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

                <View style={styles.actions}>
                  <PressScale
                    accessibilityRole="button"
                    accessibilityLabel={player.shuffleActive ? 'shuffle off' : 'shuffle'}
                    onPress={player.toggleShuffle}
                    hitSlop={8}
                  >
                    <Icon
                      name="shuffle"
                      size={20}
                      color={player.shuffleActive ? t.accent : t.inkFaint}
                    />
                  </PressScale>
                  <View style={styles.qualityRow}>
                    {QUALITIES.map((q) => {
                      const on = player.quality === q.id;
                      return (
                        <PressScale
                          key={q.id}
                          accessibilityRole="button"
                          accessibilityLabel={`quality ${q.label}`}
                          onPress={() => player.setQuality(q.id)}
                          style={[
                            styles.qualityChip,
                            { borderColor: on ? t.accent : t.line },
                            on && { backgroundColor: t.accentSoft },
                          ]}
                        >
                          <Text style={[label(11), { color: on ? t.accent : t.inkSoft }]}>
                            {q.label}
                          </Text>
                        </PressScale>
                      );
                    })}
                  </View>
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
                </View>

                {nextTrack ? (
                  <Animated.View entering={upNextEnter}>
                    <PressScale
                      accessibilityRole="button"
                      accessibilityLabel="up next, open queue"
                      onPress={openQueue}
                    >
                      <Glass radius={radii.pill} style={styles.upNext} elevated={false}>
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
                  </Animated.View>
                ) : (
                  <View style={styles.upNextSpacer} />
                )}
              </View>
            </Animated.View>
          </Animated.View>

          {showFlight && backdrop && (
            <Animated.View pointerEvents="none" style={[styles.flight, flightStyle]}>
              <Image source={{ uri: backdrop }} style={styles.flightImg} />
              <Image
                source={{ uri: backdrop }}
                blurRadius={12}
                style={[StyleSheet.absoluteFill, styles.flightImg]}
              />
            </Animated.View>
          )}
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    elevation: 30,
    overflow: 'hidden',
  },
  fill: { flex: 1 },
  circle: { position: 'absolute', overflow: 'hidden' },
  stage: { position: 'absolute' },
  backdrop: {
    position: 'absolute',
    opacity: 0.9,
    transform: [{ scale: 1.3 }],
  },
  content: { flex: 1, paddingHorizontal: 24 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chip: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  chipSpacer: { width: 38 },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
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
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  qualityRow: { flexDirection: 'row', gap: 6 },
  qualityChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
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
  chevRight: { transform: [{ rotate: '-90deg' }] },
  upNextSpacer: { height: 44, marginTop: 16 },
  flight: { position: 'absolute', overflow: 'hidden' },
  flightImg: { width: '100%', height: '100%' },
});
