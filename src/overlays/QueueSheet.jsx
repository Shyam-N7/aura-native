import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { usePlaybackProgress } from '../hooks/usePlaybackProgress';
import { openTrackActions } from '../lib/trackActionsSheet';
import { TrackArt } from '../components/TrackRow';
import { Icon } from '../components/Icon';
import { cleanTitle } from '../utils/title';
import { fmtTime } from '../utils/fmtTime';
import { LONG_LIST } from '../lib/listWindow';
import { label, radii } from '../theme/tokens';
import { DUR, EASE, SPRING } from '../theme/motion';

const ROW_HEIGHT = 62;
const SHIFT_MS = 160;
const EDGE = 90;

// The current row's live line: 'now playing' + a thin bar gliding between
// the 1Hz position ticks. No times here (field feedback: clutter at row
// size) — the row's right edge keeps the total, the player owns the clock.
// Isolated so the ticker re-renders only this leaf, never the list.
function NowPlayingLine({ t }) {
  const { position, duration } = usePlaybackProgress(1000);
  const frac = duration > 0 ? Math.min(1, position / duration) : 0;
  const w = useSharedValue(frac);
  useEffect(() => {
    w.value = withTiming(frac, { duration: 1000, easing: Easing.linear });
  }, [frac, w]);
  const fill = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={styles.npLine}>
      <Text style={[label(8.5), { color: t.accent }]}>now playing</Text>
      <View style={[styles.npBar, { backgroundColor: t.line }]}>
        <Animated.View
          style={[styles.npFill, { backgroundColor: t.accent }, fill]}
        />
      </View>
    </View>
  );
}

// One queue row. Drag-reorder ports the web DesktopQueue math onto fixed-height
// rows: the dragged row rides the finger (translation + scroll delta), rows
// between origin and target shift one slot, drop commits reorder(from, to).
// All motion is UI-thread; only pickup/commit cross to JS.
//
// Arbitration: the grip pan BLOCKS the list's native scroll gesture — a touch
// on the grip makes the scroll wait, so pickup can't lose the race (the
// earlier long-press arming, and even plain activation offsets, sometimes
// did). No scrollEnabled toggling either: that state flip re-rendered the
// whole list at the exact moment of pickup, which read as jank.
function Row({
  item,
  index,
  isCurrent,
  isPast,
  player,
  dragFrom,
  dragTo,
  dragShift,
  scrollY,
  scrollStart,
  listRef,
  listH,
  count,
  listGesture,
}) {
  const { t } = useTheme();
  const title = cleanTitle(item.title);

  const pickup = useCallback(() => {
    Vibration.vibrate(10);
  }, []);

  const commit = (from, to) => {
    if (from !== to) {
      Vibration.vibrate(8);
    }
    player.reorder(from, to);
    // Release the drag one frame later so the list paints the new order
    // before rows stop compensating — avoids a one-frame jump-back.
    requestAnimationFrame(() => {
      dragFrom.value = -1;
      dragShift.value = 0;
    });
  };

  // A second finger on another grip must not fight over the shared drag
  // slots — first pickup wins, the other pan runs inert.
  const owns = useSharedValue(false);

  const pan = Gesture.Pan()
    .activeOffsetY([-4, 4])
    .failOffsetX([-16, 16])
    .blocksExternalGesture(listGesture)
    .onStart(() => {
      'worklet';
      owns.value = dragFrom.value === -1;
      if (!owns.value) {
        return;
      }
      dragFrom.value = index;
      dragTo.value = index;
      dragShift.value = 0;
      scrollStart.value = scrollY.value;
      runOnJS(pickup)();
    })
    .onUpdate(e => {
      'worklet';
      if (!owns.value) {
        return;
      }
      dragShift.value = e.translationY + scrollY.value - scrollStart.value;
      const to = index + Math.round(dragShift.value / ROW_HEIGHT);
      dragTo.value = Math.max(0, Math.min(count - 1, to));
      // Edge auto-scroll (re-triggered per move event).
      if (e.absoluteY < EDGE + 60) {
        scrollTo(listRef, 0, Math.max(0, scrollY.value - 14), false);
      } else if (e.absoluteY > listH.value - EDGE) {
        scrollTo(listRef, 0, scrollY.value + 14, false);
      }
    })
    .onEnd(() => {
      'worklet';
      if (!owns.value) {
        return;
      }
      runOnJS(commit)(dragFrom.value, dragTo.value);
    })
    .onFinalize((_e, success) => {
      'worklet';
      if (!owns.value) {
        return;
      }
      if (!success) {
        dragFrom.value = -1;
        dragShift.value = 0;
      }
      owns.value = false;
    });

  const rowStyle = useAnimatedStyle(() => {
    if (dragFrom.value === index) {
      return {
        zIndex: 5,
        transform: [{ translateY: dragShift.value }, { scale: 1.01 }],
      };
    }
    let shift = 0;
    if (dragFrom.value >= 0) {
      if (dragFrom.value < index && index <= dragTo.value) {
        shift = -ROW_HEIGHT;
      } else if (dragTo.value <= index && index < dragFrom.value) {
        shift = ROW_HEIGHT;
      }
    }
    return {
      zIndex: 0,
      transform: [
        { translateY: withTiming(shift, { duration: SHIFT_MS }) },
        { scale: 1 },
      ],
    };
  });

  const liftStyle = useAnimatedStyle(() => ({
    // Opaque surface while lifted so the row reads over its neighbours
    // (never elevation — translucent + elevation = white slab).
    backgroundColor:
      dragFrom.value === index
        ? t.surface
        : isCurrent
        ? t.accentSoft
        : 'transparent',
  }));

  return (
    <Animated.View style={[styles.row, isPast && styles.past, rowStyle]}>
      <Animated.View style={[styles.rowFill, liftStyle]} />
      <GestureDetector gesture={pan}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`reorder ${title}`}
          hitSlop={8}
          style={styles.grip}
        >
          <Icon name="grip" size={18} color={t.inkFaint} />
        </Pressable>
      </GestureDetector>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`play ${title}`}
        onPress={() => player.jumpTo(index)}
        onLongPress={() =>
          openTrackActions({
            track: item,
            // Queue rows: play/queue actions are redundant here (web parity).
            menu: { omit: ['play', 'playNext', 'addToQueue'] },
          })
        }
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
      >
        <Text style={[styles.idx, { color: t.inkFaint }]}>
          {String(index + 1).padStart(2, '0')}
        </Text>
        <TrackArt track={item} size={44} radius={7} />
        <View style={styles.meta}>
          <Text
            numberOfLines={1}
            style={[styles.title, { color: isCurrent ? t.accent : t.ink }]}
          >
            {title}
          </Text>
          {isCurrent ? (
            <NowPlayingLine t={t} />
          ) : (
            <Text
              numberOfLines={1}
              style={[styles.artist, { color: t.inkSoft }]}
            >
              {item.artist ?? ''}
            </Text>
          )}
        </View>
        {!!item.durationSec && (
          <Text style={[styles.time, { color: t.inkFaint }]}>
            {fmtTime(item.durationSec)}
          </Text>
        )}
      </Pressable>
      {!isCurrent && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`remove ${title}`}
          onPress={() => player.removeAt(index)}
          hitSlop={8}
          style={styles.remove}
        >
          <Icon name="close" size={15} color={t.inkFaint} />
        </Pressable>
      )}
    </Animated.View>
  );
}

// The live queue as its own overlay ABOVE the player sheet: opening it never
// closes the player, and closing it lands back exactly where you were (field
// feedback — the old navigator screen forced the player shut first). Slides
// up like the player, drags down from its header to dismiss, hardware back
// closes it first (registered later than the player's handler, LIFO).
export function QueueSheet() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const player = usePlayer();
  const reduced = useReducedMotion();
  const open = player.ui?.queueOpen ?? false;
  const { tracks, idx, source } = player.queue ?? {
    tracks: [],
    idx: -1,
    source: null,
  };

  // 'closed' | 'open' | 'closing' — the PlayerSheet mount grammar.
  const [vis, setVis] = useState('closed');
  const slide = useSharedValue(winH);
  const dragY = useSharedValue(0);

  const endClose = useCallback(() => setVis('closed'), []);

  useEffect(() => {
    if (open && vis === 'closed') {
      dragY.value = 0;
      if (reduced) {
        slide.value = 0;
      } else {
        slide.value = winH;
        slide.value = withSpring(0, SPRING.sheet);
      }
      setVis('open');
    }
    // Closed from outside the sheet (sign-out) — resync the mount machine so
    // the next open still gets its slide-in.
    if (!open && vis === 'open') {
      setVis('closed');
    }
  }, [open, vis, reduced, winH, slide, dragY]);

  const close = useCallback(() => {
    if (vis === 'closing') {
      return;
    }
    setVis('closing');
    player.ui?.closeQueue?.();
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

  const dragFrom = useSharedValue(-1);
  const dragTo = useSharedValue(-1);
  const dragShift = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const scrollStart = useSharedValue(0);
  const listH = useSharedValue(0);
  const listRef = useAnimatedRef();

  // The list's own scroll as an explicit gesture, so row grips can make it
  // wait (see Row).
  const listGesture = useMemo(() => Gesture.Native(), []);

  const onScroll = useAnimatedScrollHandler(e => {
    scrollY.value = e.contentOffset.y;
  });

  // Drag-follow dismiss from the header; the close() slide-out starts from
  // wherever the drag left the sheet (the transforms sum), no jump.
  const dismissPan = Gesture.Pan()
    .activeOffsetY(16)
    .failOffsetY(-16)
    .onUpdate(e => {
      'worklet';
      dragY.value = Math.max(0, e.translationY);
    })
    .onEnd(e => {
      'worklet';
      if (e.velocityY > 900 || dragY.value > winH * 0.22) {
        runOnJS(close)();
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

  if (!open && vis !== 'closing') {
    return null;
  }

  const renderItem = ({ item, index }) => (
    <Row
      item={item}
      index={index}
      isCurrent={index === idx}
      isPast={index < idx}
      player={player}
      dragFrom={dragFrom}
      dragTo={dragTo}
      dragShift={dragShift}
      scrollY={scrollY}
      scrollStart={scrollStart}
      listRef={listRef}
      listH={listH}
      count={tracks.length}
      listGesture={listGesture}
    />
  );

  // AURA's prefetched continuation, listed under the last track as what's
  // coming. The context hands this over already deduped against the live queue
  // and only while it's actually reachable, so row i is queue position idx+1+i
  // and tapping one fills the whole batch in and plays from there.
  const radioBatch = player.autoNextTracks;
  const renderRadio = () => {
    if (!radioBatch?.length) {
      return null;
    }
    return (
      <View style={[styles.radio, { borderTopColor: t.line }]}>
        <Text style={[label(9), { color: t.inkFaint }, styles.radioLabel]}>
          up next · picked by aura
        </Text>
        {radioBatch.map((rt, i) => (
          <Pressable
            key={`${rt.id}-${i}`}
            accessibilityRole="button"
            accessibilityLabel={`play next: ${cleanTitle(rt.title)}`}
            onPress={() => player.playAutoNext(i)}
            onLongPress={() => openTrackActions(rt)}
            style={({ pressed }) => [styles.radioRow, pressed && styles.pressed]}
          >
            <TrackArt track={rt} size={40} radius={4} />
            <View style={styles.meta}>
              <Text numberOfLines={1} style={[styles.title, { color: t.ink }]}>
                {cleanTitle(rt.title)}
              </Text>
              <Text
                numberOfLines={1}
                style={[styles.artist, { color: t.inkSoft }]}
              >
                {rt.artist ?? ''}
              </Text>
            </View>
            <Text style={[label(9), { color: t.accent }]}>play</Text>
          </Pressable>
        ))}
      </View>
    );
  };

  return (
    <Animated.View
      style={[
        styles.root,
        { backgroundColor: t.bg, paddingTop: insets.top },
        sheetStyle,
      ]}
    >
      <GestureDetector gesture={dismissPan}>
        <View>
          <View style={[styles.sheetGrip, { backgroundColor: t.line }]} />
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="close queue"
              onPress={close}
              hitSlop={10}
              style={styles.back}
            >
              <Icon name="chevron-down" size={24} color={t.ink} />
            </Pressable>
            <View style={styles.headMeta}>
              <Text style={[styles.source, { color: t.ink }]}>
                {source ?? 'up next'}
              </Text>
              <Text style={[styles.count, { color: t.inkFaint }]}>
                {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                player.shuffleActive ? 'shuffle off' : 'shuffle'
              }
              onPress={player.toggleShuffle}
              hitSlop={8}
              style={styles.toggle}
            >
              <Icon
                name="shuffle"
                size={20}
                color={player.shuffleActive ? t.accent : t.inkFaint}
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`repeat ${player.repeat}`}
              onPress={player.cycleRepeat}
              hitSlop={8}
              style={styles.toggle}
            >
              <Icon
                name={player.repeat === 'one' ? 'repeat-one' : 'repeat'}
                size={20}
                color={player.repeat !== 'off' ? t.accent : t.inkFaint}
              />
            </Pressable>
          </View>
        </View>
      </GestureDetector>

      {tracks.length === 0 ? (
        <Text style={[styles.empty, { color: t.inkFaint }]}>
          nothing queued yet — play something first.
        </Text>
      ) : (
        <GestureDetector gesture={listGesture}>
          <Animated.FlatList
            ref={listRef}
            data={tracks}
            renderItem={renderItem}
            keyExtractor={(item, index) => `${item.id}-${index}`}
            getItemLayout={(_, index) => ({
              length: ROW_HEIGHT,
              offset: ROW_HEIGHT * index,
              index,
            })}
            initialScrollIndex={Math.max(0, Math.min(idx, tracks.length - 1))}
            // An element, not a component type — a fresh type each render would
            // remount the batch (and its artwork) on every scroll tick.
            ListFooterComponent={renderRadio()}
            onScroll={onScroll}
            scrollEventThrottle={16}
            overScrollMode="always"
            onLayout={e => {
              listH.value = e.nativeEvent.layout.height;
            }}
            // Shifted neighbours must draw outside their cell while dragging.
            removeClippedSubviews={false}
            // A queue can be a whole shared playlist (245 tracks in the
            // field) — unbounded mounting OOM-killed the app on open.
            {...LONG_LIST}
            contentContainerStyle={[
              styles.list,
              { paddingBottom: insets.bottom + 24 },
            ]}
          />
        </GestureDetector>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    // zIndex only — see PlayerSheet.root for the overlay ladder.
    zIndex: 40,
    overflow: 'hidden',
  },
  sheetGrip: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginTop: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
  },
  back: {
    width: 32,
    alignItems: 'center',
  },
  headMeta: {
    flex: 1,
    gap: 1,
  },
  source: {
    fontSize: 17,
    fontWeight: '600',
  },
  count: {
    fontSize: 12,
  },
  toggle: {
    paddingHorizontal: 6,
  },
  list: {
    paddingHorizontal: 10,
    paddingTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ROW_HEIGHT,
    borderRadius: 10,
    paddingLeft: 2,
    paddingRight: 4,
  },
  rowFill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 10,
  },
  past: {
    opacity: 0.55,
  },
  radio: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  radioLabel: {
    paddingHorizontal: 6,
    marginBottom: 4,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 56,
    borderRadius: 10,
    paddingHorizontal: 6,
  },
  grip: {
    width: 30,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pressed: {
    opacity: 0.6,
  },
  idx: {
    width: 22,
    fontSize: 11,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  meta: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 14.5,
    fontWeight: '500',
  },
  artist: {
    fontSize: 12,
  },
  npLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  npBar: {
    flex: 1,
    height: 3,
    // Radius past half-height clamps to a true pill, so the caps render
    // round even at this size (1.5 came out visibly squared-off on device).
    borderRadius: 999,
    overflow: 'hidden',
  },
  npFill: {
    height: 3,
    borderRadius: 999,
  },
  time: {
    fontSize: 11.5,
    fontVariant: ['tabular-nums'],
  },
  remove: {
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  empty: {
    fontSize: 13.5,
    paddingHorizontal: 20,
    marginTop: 16,
  },
});
