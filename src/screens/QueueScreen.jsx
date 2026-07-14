import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { openTrackActions } from '../lib/trackActionsSheet';
import { TrackArt } from '../components/TrackRow';
import { Icon } from '../components/Icon';
import { cleanTitle } from '../utils/title';
import { fmtTime } from '../utils/fmtTime';

const ROW_HEIGHT = 62;

// The live queue: tap a row to jump, ✕ to drop it, shuffle/repeat toggles in
// the header. Drag-reorder waits for a later phase.
export default function QueueScreen({ navigation }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const { tracks, idx, source } = player.queue ?? {
    tracks: [],
    idx: -1,
    source: null,
  };

  const renderItem = ({ item, index }) => {
    const isCurrent = index === idx;
    const isPast = index < idx;
    const title = cleanTitle(item.title);
    return (
      <View
        style={[
          styles.row,
          isCurrent && { backgroundColor: t.accentSoft },
          isPast && styles.past,
        ]}>
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
          style={({ pressed }) => [styles.main, pressed && styles.pressed]}>
          <Text style={[styles.idx, { color: t.inkFaint }]}>
            {String(index + 1).padStart(2, '0')}
          </Text>
          <TrackArt track={item} size={44} radius={7} />
          <View style={styles.meta}>
            <Text
              numberOfLines={1}
              style={[styles.title, { color: isCurrent ? t.accent : t.ink }]}>
              {title}
            </Text>
            <Text
              numberOfLines={1}
              style={[styles.artist, { color: t.inkSoft }]}>
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
            style={styles.remove}>
            <Icon name="close" size={15} color={t.inkFaint} />
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <View
      style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="close queue"
          onPress={() => navigation.goBack()}
          hitSlop={10}
          style={styles.back}>
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
          style={styles.toggle}>
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
          style={styles.toggle}>
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
        <FlatList
          data={tracks}
          renderItem={renderItem}
          keyExtractor={(item, index) => `${item.id}-${index}`}
          getItemLayout={(_, index) => ({
            length: ROW_HEIGHT,
            offset: ROW_HEIGHT * index,
            index,
          })}
          initialScrollIndex={Math.max(0, Math.min(idx, tracks.length - 1))}
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
    paddingLeft: 6,
    paddingRight: 4,
  },
  past: {
    opacity: 0.55,
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
