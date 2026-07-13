import React, { useContext, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainerRefContext } from '@react-navigation/native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { usePlaybackProgress } from '../hooks/usePlaybackProgress';
import { QUALITIES } from '../lib/audioQuality';
import { TrackArt } from '../components/TrackRow';
import { Icon } from '../components/Icon';
import { cleanTitle } from '../utils/title';
import { fmtTime } from '../utils/fmtTime';

const clamp01 = v => Math.min(1, Math.max(0, v));

// Draggable progress bar. Renders from the RNTP ticker; while a finger is on
// it the drag position wins, and the seek commits on release.
function Scrubber({ onSeek, t }) {
  const { position, duration } = usePlaybackProgress();
  const [width, setWidth] = useState(0);
  const [dragX, setDragX] = useState(null);
  // Latest drag x for the commit — gesture callbacks close over stale state.
  const dragRef = useRef(null);
  const setDrag = x => {
    dragRef.current = x;
    setDragX(x);
  };

  const shown =
    dragX != null && width > 0
      ? clamp01(dragX / width)
      : duration > 0
        ? clamp01(position / duration)
        : 0;

  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin(e => setDrag(e.x))
    .onUpdate(e => setDrag(e.x))
    .onEnd(() => {
      const x = dragRef.current;
      if (x != null && width > 0 && duration > 0) {
        onSeek(clamp01(x / width) * duration);
      }
    })
    .onFinalize(() => setDrag(null));

  return (
    <View>
      <GestureDetector gesture={pan}>
        <View
          style={styles.scrubHit}
          onLayout={e => setWidth(e.nativeEvent.layout.width)}>
          <View style={[styles.scrubTrack, { backgroundColor: t.line }]}>
            <View
              style={[
                styles.scrubFill,
                { backgroundColor: t.accent, width: `${shown * 100}%` },
              ]}
            />
          </View>
          <View
            style={[
              styles.scrubThumb,
              { backgroundColor: t.accent, left: Math.max(0, shown * width - 6) },
            ]}
          />
        </View>
      </GestureDetector>
      <View style={styles.timeRow}>
        <Text style={[styles.time, { color: t.inkFaint }]}>
          {fmtTime(shown * duration)}
        </Text>
        <Text style={[styles.time, { color: t.inkFaint }]}>
          -{fmtTime(duration * (1 - shown))}
        </Text>
      </View>
    </View>
  );
}

// Full-screen now-playing overlay, visible while usePlayer().ui.playerOpen.
// Mount it INSIDE NavigationContainer (a sibling of RootTabs) so "up next"
// can open the Queue screen; mounted outside it still works, minus that hop.
export function PlayerSheet() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const player = usePlayer();
  // The container ref context never throws outside a navigator (useNavigation
  // does), so the sheet survives wherever the integrator mounts it.
  const navRoot = useContext(NavigationContainerRefContext);

  const track = player.current;
  const open = player.ui?.playerOpen ?? false;

  const closePan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY(24)
    .onEnd(e => {
      if (e.translationY > 100) {
        player.ui?.closePlayer?.();
      }
    });

  if (!open || !track) {
    return null;
  }

  const queue = player.queue ?? { tracks: [], idx: -1, source: null };
  const nextTrack = queue.tracks[queue.idx + 1] ?? null;
  const artSize = Math.min(winW - 72, 360);

  const close = () => player.ui?.closePlayer?.();
  const openQueue = () => {
    close();
    if (navRoot?.isReady?.()) {
      navRoot.navigate('Queue');
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: t.pageBg }]}>
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="psbg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={t.stageBgStart} />
            <Stop offset="1" stopColor={t.stageBgEnd} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#psbg)" />
      </Svg>

      <GestureDetector gesture={closePan}>
        <View
          style={[
            styles.content,
            { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 18 },
          ]}>
          <View style={styles.top}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="close player"
              onPress={close}
              hitSlop={10}
              style={styles.chip}>
              <Icon name="chevron-down" size={24} color={t.ink} />
            </Pressable>
            <Text style={[styles.source, { color: t.inkFaint }]}>
              {queue.source ?? 'now playing'}
            </Text>
            <View style={styles.chip} />
          </View>

          <View style={styles.hero}>
            <TrackArt track={track} size={artSize} radius={12} res={500} />
          </View>

          <View style={styles.meta}>
            <Text numberOfLines={2} style={[styles.title, { color: t.ink }]}>
              {cleanTitle(track.title)}
            </Text>
            {!!track.artist && (
              <Text
                numberOfLines={1}
                style={[styles.artist, { color: t.inkSoft }]}>
                {track.artist}
              </Text>
            )}
          </View>

          <Scrubber onSeek={player.seekTo} t={t} />

          <View style={styles.transport}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="previous"
              onPress={player.prev}
              hitSlop={10}>
              <Icon name="prev" size={30} color={t.ink} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={player.isPlaying ? 'pause' : 'play'}
              onPress={player.togglePlay}
              style={[styles.playBtn, { backgroundColor: t.accent }]}>
              <Icon
                name={player.isPlaying ? 'pause' : 'play'}
                size={30}
                color={t.surface}
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="next"
              onPress={player.next}
              hitSlop={10}>
              <Icon name="next" size={30} color={t.ink} />
            </Pressable>
          </View>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                player.shuffleActive ? 'shuffle off' : 'shuffle'
              }
              onPress={player.toggleShuffle}
              hitSlop={8}>
              <Icon
                name="shuffle"
                size={20}
                color={player.shuffleActive ? t.accent : t.inkFaint}
              />
            </Pressable>
            <View style={styles.qualityRow}>
              {QUALITIES.map(q => {
                const on = player.quality === q.id;
                return (
                  <Pressable
                    key={q.id}
                    accessibilityRole="button"
                    accessibilityLabel={`quality ${q.label}`}
                    onPress={() => player.setQuality(q.id)}
                    style={[
                      styles.qualityChip,
                      { borderColor: on ? t.accent : t.line },
                      on && { backgroundColor: t.accentSoft },
                    ]}>
                    <Text
                      style={[
                        styles.qualityText,
                        { color: on ? t.accent : t.inkSoft },
                      ]}>
                      {q.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`repeat ${player.repeat}`}
              onPress={player.cycleRepeat}
              hitSlop={8}>
              <Icon
                name={player.repeat === 'one' ? 'repeat-one' : 'repeat'}
                size={20}
                color={player.repeat !== 'off' ? t.accent : t.inkFaint}
              />
            </Pressable>
          </View>

          {nextTrack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="up next, open queue"
              onPress={openQueue}
              style={[
                styles.upNext,
                { backgroundColor: t.surface, borderColor: t.line },
              ]}>
              <TrackArt track={nextTrack} size={30} radius={6} />
              <View style={styles.upNextMeta}>
                <Text style={[styles.upNextLabel, { color: t.inkFaint }]}>
                  up next
                </Text>
                <Text
                  numberOfLines={1}
                  style={[styles.upNextTitle, { color: t.ink }]}>
                  {cleanTitle(nextTrack.title)}
                </Text>
              </View>
              <View style={styles.chevRight}>
                <Icon name="chevron-down" size={16} color={t.inkFaint} />
              </View>
            </Pressable>
          ) : (
            <View style={styles.upNextSpacer} />
          )}
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    elevation: 30,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chip: {
    width: 32,
    alignItems: 'center',
  },
  source: {
    fontSize: 12,
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  meta: {
    gap: 4,
    marginBottom: 14,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
  },
  artist: {
    fontSize: 15,
  },
  scrubHit: {
    height: 36,
    justifyContent: 'center',
  },
  scrubTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  scrubFill: {
    height: 4,
    borderRadius: 2,
  },
  scrubThumb: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  time: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    marginTop: 10,
  },
  playBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
  },
  qualityRow: {
    flexDirection: 'row',
    gap: 6,
  },
  qualityChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  qualityText: {
    fontSize: 12,
  },
  upNext: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 18,
  },
  upNextMeta: {
    flex: 1,
    gap: 1,
  },
  upNextLabel: {
    fontSize: 10,
    textTransform: 'lowercase',
  },
  upNextTitle: {
    fontSize: 13.5,
    fontWeight: '500',
  },
  chevRight: {
    transform: [{ rotate: '-90deg' }],
  },
  upNextSpacer: {
    height: 46,
    marginTop: 18,
  },
});
