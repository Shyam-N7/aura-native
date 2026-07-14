import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { openTrackActions } from '../lib/trackActionsSheet';
import { TrackArt } from '../components/TrackRow';
import { Icon } from '../components/Icon';
import { cleanTitle } from '../utils/title';
import { fmtTime } from '../utils/fmtTime';

const ROW_HEIGHT = 62;
// Hold the grip briefly to pick a row up — instant pans would fight the
// list's own scroll gesture.
const PICKUP_MS = 180;
const SHIFT_MS = 160;
const EDGE = 90;

// One queue row. Drag-reorder ports the web DesktopQueue math onto fixed-height
// rows: the dragged row rides the finger (translation + scroll delta), rows
// between origin and target shift one slot, drop commits reorder(from, to).
// All motion is UI-thread; only pickup/commit cross to JS.
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
  onDragging,
}) {
  const { t } = useTheme();
  const title = cleanTitle(item.title);

  const commit = (from, to) => {
    player.reorder(from, to);
    // Release the drag one frame later so the list paints the new order
    // before rows stop compensating — avoids a one-frame jump-back.
    requestAnimationFrame(() => {
      dragFrom.value = -1;
      dragShift.value = 0;
      onDragging(false);
    });
  };

  const pan = Gesture.Pan()
    .activateAfterLongPress(PICKUP_MS)
    .onStart(() => {
      'worklet';
      dragFrom.value = index;
      dragTo.value = index;
      dragShift.value = 0;
      scrollStart.value = scrollY.value;
      runOnJS(onDragging)(true);
    })
    .onUpdate(e => {
      'worklet';
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
      runOnJS(commit)(dragFrom.value, dragTo.value);
    })
    .onFinalize((_e, success) => {
      'worklet';
      if (!success) {
        dragFrom.value = -1;
        dragShift.value = 0;
        runOnJS(onDragging)(false);
      }
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
          hitSlop={6}
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
          <Text numberOfLines={1} style={[styles.artist, { color: t.inkSoft }]}>
            {isCurrent ? 'now playing' : item.artist ?? ''}
          </Text>
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

// The live queue: tap a row to jump, ✕ to drop it, hold the grip to reorder,
// shuffle/repeat toggles in the header.
export default function QueueScreen({ navigation }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const { tracks, idx, source } = player.queue ?? {
    tracks: [],
    idx: -1,
    source: null,
  };

  const [dragging, setDragging] = useState(false);
  const dragFrom = useSharedValue(-1);
  const dragTo = useSharedValue(-1);
  const dragShift = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const scrollStart = useSharedValue(0);
  const listH = useSharedValue(0);
  const listRef = useAnimatedRef();

  const onScroll = useAnimatedScrollHandler(e => {
    scrollY.value = e.contentOffset.y;
  });

  const onDragging = useCallback(on => setDragging(on), []);

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
      onDragging={onDragging}
    />
  );

  return (
    <View
      style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="close queue"
          onPress={() => navigation.goBack()}
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
          accessibilityLabel={player.shuffleActive ? 'shuffle off' : 'shuffle'}
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

      {tracks.length === 0 ? (
        <Text style={[styles.empty, { color: t.inkFaint }]}>
          nothing queued yet — play something first.
        </Text>
      ) : (
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
          onScroll={onScroll}
          scrollEventThrottle={16}
          scrollEnabled={!dragging}
          onLayout={e => {
            listH.value = e.nativeEvent.layout.height;
          }}
          // Shifted neighbours must draw outside their cell while dragging.
          removeClippedSubviews={false}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + 24 },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
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
  grip: {
    width: 26,
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
