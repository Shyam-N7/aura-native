import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Image,
  Keyboard,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  Keyframe,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { usePlaybackProgress } from '../hooks/usePlaybackProgress';
import { QUALITIES } from '../lib/audioQuality';
import { getSleepState, subscribeSleep } from '../lib/sleepTimer';
import { openSleepTimer } from '../lib/sleepTimerSheet';
import { openAddToPlaylist } from '../lib/addToPlaylistSheet';
import { TrackArt } from '../components/TrackRow';
import { HeartButton } from '../components/player/HeartButton';
import { ProgressRibbon } from '../components/player/ProgressRibbon';
import { Icon } from '../components/Icon';
import { Glass } from '../components/ui/Glass';
import { GradientBg } from '../components/ui/GradientBg';
import { PressScale } from '../components/ui/PressScale';
import { cleanTitle } from '../utils/title';
import { fmtTime } from '../utils/fmtTime';
import { type, label, radii, elevation } from '../theme/tokens';
import { DUR, EASE, SPRING } from '../theme/motion';

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
        <TrackArt
          track={track}
          size={size}
          radius={radii.playerArt}
          res={500}
        />
      </View>
      {twin && url && (
        <Image
          source={{ uri: url }}
          blurRadius={8}
          style={[
            styles.twin,
            { width: size, height: size, borderRadius: radii.playerArt },
          ]}
        />
      )}
    </View>
  );
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

  const track = player.current;
  const open = player.ui?.playerOpen ?? false;

  // 'closed' | 'open' | 'closing'
  const [vis, setVis] = useState('closed');
  const [heroH, setHeroH] = useState(0);

  const slide = useSharedValue(winH);
  const dragY = useSharedValue(0);
  const backdropFade = useSharedValue(0);
  const breathe = useSharedValue(0.85);

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
  const playing = player.isPlaying;
  useEffect(() => {
    if (playing && !reduced) {
      breathe.value = withRepeat(
        withTiming(1.08, {
          duration: DUR.breathe / 2,
          easing: Easing.inOut(Easing.sin),
        }),
        -1,
        true,
      );
    } else {
      breathe.value = withTiming(0.85, { duration: 300 });
    }
  }, [playing, reduced, breathe]);

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
  const nextTrack = queue.tracks[queue.idx + 1] ?? null;
  // Cap the art by the hero row's real height too — with the keyboard up (or
  // any squeezed window) a width-only size overflows onto the title below.
  const artSize = Math.min(
    winW - 72,
    360,
    heroH > 0 ? heroH - 16 : Number.MAX_SAFE_INTEGER,
  );
  const backdrop = artUrl(track);

  // The queue opens as its own sheet above this one — the player stays put
  // and is exactly where you left it when the queue closes.
  const openQueue = () => {
    player.ui?.openQueue?.();
  };

  return (
    <Animated.View
      style={[styles.root, { backgroundColor: t.pageBg }, sheetStyle]}
    >
      <GestureDetector gesture={dismissPan}>
        <View style={styles.fill}>
          <GradientBg
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
              <Image
                source={{ uri: backdrop }}
                blurRadius={48}
                style={[styles.backdrop, { width: winW, height: winH }]}
              />
            </Animated.View>
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
              <Text style={[label(11), { color: t.inkFaint }]}>
                {queue.source ?? 'now playing'}
              </Text>
              <View style={styles.topCluster}>
                <PressScale
                  accessibilityRole="button"
                  accessibilityLabel="add to playlist"
                  onPress={() => openAddToPlaylist(track)}
                  hitSlop={8}
                >
                  <Glass radius={19} style={styles.chip}>
                    <Icon name="plus" size={20} color={t.ink} />
                  </Glass>
                </PressScale>
                <Glass radius={19} style={styles.chip}>
                  <HeartButton
                    trackId={track.id}
                    size={20}
                    color={t.ink}
                    accent={t.accent}
                  />
                </Glass>
              </View>
            </View>

            <View
              style={styles.hero}
              onLayout={e => setHeroH(e.nativeEvent.layout.height)}
            >
              <ArtDevelop track={track} size={artSize} />
            </View>

            <View style={styles.meta}>
              <Text
                numberOfLines={2}
                style={[type.playerTitle, styles.center, { color: t.ink }]}
              >
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

            <View style={styles.actions}>
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
              <View style={styles.qualityRow}>
                {QUALITIES.map(q => {
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
                      <Text
                        style={[
                          label(11),
                          { color: on ? t.accent : t.inkSoft },
                        ]}
                      >
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
            </View>

            {nextTrack ? (
              <Animated.View entering={upNextEnter}>
                <PressScale
                  accessibilityRole="button"
                  accessibilityLabel="up next, open queue"
                  onPress={openQueue}
                >
                  <Glass radius={radii.pill} style={styles.upNext}>
                    <View style={styles.upNextRow}>
                      <TrackArt track={nextTrack} size={28} radius={5} />
                      <View style={styles.upNextMeta}>
                        <Text style={[label(7.5), { color: t.inkFaint }]}>
                          up next
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={[styles.upNextTitle, { color: t.ink }]}
                        >
                          {cleanTitle(nextTrack.title)}
                        </Text>
                      </View>
                      <View style={styles.chevRight}>
                        <Icon
                          name="chevron-down"
                          size={16}
                          color={t.inkFaint}
                        />
                      </View>
                    </View>
                  </Glass>
                </PressScale>
              </Animated.View>
            ) : (
              <View style={styles.upNextSpacer} />
            )}
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
  topCluster: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
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
});
