import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { listLiked } from '../api/likes';
import { useLikes } from '../hooks/useLikes';
import { TrackArt } from '../components/TrackRow';
import { HeartButton } from '../components/player/HeartButton';
import { Icon } from '../components/Icon';
import { PressScale } from '../components/ui/PressScale';
import { fonts, label, type } from '../theme/tokens';
import { cleanTitle } from '../utils/title';
import { fmtTime, fmtRuntime } from '../utils/fmtTime';

// Full-page liked songs, ported from web DesktopLiked: hero header, count +
// total runtime, numbered rows with a heart that drops the row on unlike.
export default function LikedScreen({ navigation }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const { isLiked, ready } = useLikes();
  const [hit, setHit] = useState({ data: null, error: null });
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';

  useEffect(() => {
    const ctl = new AbortController();
    listLiked({ signal: ctl.signal })
      .then(data => setHit({ data, error: null }))
      .catch(err => {
        if (err.name !== 'AbortError') {
          setHit({ data: null, error: err.message });
        }
      });
    return () => ctl.abort();
  }, []);

  // Show the server's liked list, dropping a row the moment it's unliked here.
  // Guard on `ready`: until the client like-set has booted, isLiked() is empty
  // and would hide everything (the "liked looks empty" race).
  const liked = (hit.data ?? []).filter(x => !ready || isLiked(x.id));

  const playFrom = i => {
    player.playQueue(liked, i, 'your liked');
    player.ui?.openPlayer?.();
  };

  const header = (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="back"
        onPress={() => navigation.goBack()}
        hitSlop={10}
        style={styles.back}
      >
        <Icon name="chevron-left" size={24} color={t.ink} />
      </Pressable>
      {status === 'loading' && (
        <Text style={[styles.stateLine, { color: t.inkFaint }]}>
          Loading liked songs
        </Text>
      )}
      {status === 'error' && (
        <Text style={[styles.stateLine, { color: t.inkSoft }]}>
          Couldn't load — {hit.error}
        </Text>
      )}
      {status === 'ok' && (
        <>
          <Text style={[label(9.5), { color: t.inkFaint }]}>
            your collection
          </Text>
          <Text style={[type.queueHero, { color: t.ink }]}>liked</Text>
          {liked.length > 0 && (
            <Text style={[label(9.5), { color: t.inkSoft }]}>by you</Text>
          )}
          {liked.length > 0 && (
            <PressScale
              accessibilityRole="button"
              accessibilityLabel="play all"
              onPress={() => playFrom(0)}
              style={[styles.playAll, { backgroundColor: t.accent }]}
            >
              <View style={[styles.playDisc, { backgroundColor: t.surface }]}>
                <Icon name="play" size={11} color={t.accent} />
              </View>
              <Text style={[styles.playAllText, { color: t.surface }]}>
                Play all
              </Text>
            </PressScale>
          )}
          {liked.length > 0 && (
            <Text style={[label(10), styles.count, { color: t.inkFaint }]}>
              {liked.length} {liked.length === 1 ? 'song' : 'songs'} ·{' '}
              {fmtRuntime(liked.reduce((s, x) => s + (x.durationSec || 0), 0))}
            </Text>
          )}
          {liked.length === 0 && (
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: t.ink }]}>
                No liked songs yet.
              </Text>
              <Text style={[styles.emptyBody, { color: t.inkSoft }]}>
                Tap the heart on any song to start your collection.
              </Text>
            </View>
          )}
        </>
      )}
    </View>
  );

  const renderItem = ({ item, index }) => {
    const title = cleanTitle(item.title);
    return (
      <View style={styles.row}>
        <Text style={[styles.idx, { color: t.inkFaint }]}>
          {String(index + 1).padStart(2, '0')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`play ${title}`}
          onPress={() => playFrom(index)}
          style={({ pressed }) => [styles.main, pressed && styles.pressed]}
        >
          <TrackArt track={item} size={54} radius={4} />
          <View style={styles.meta}>
            <Text numberOfLines={1} style={[styles.title, { color: t.ink }]}>
              {title}
            </Text>
            <Text numberOfLines={1} style={[label(9.5), { color: t.inkSoft }]}>
              {(item.artist ?? '').toLowerCase()} · {item.language ?? ''}
            </Text>
          </View>
          {!!item.durationSec && (
            <Text style={[type.time, { color: t.inkFaint }]}>
              {fmtTime(item.durationSec)}
            </Text>
          )}
        </Pressable>
        <HeartButton
          trackId={item.id}
          size={18}
          color={t.inkFaint}
          accent={t.accent}
        />
      </View>
    );
  };

  return (
    <View
      style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}
    >
      <FlatList
        data={status === 'ok' ? liked : []}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        ListHeaderComponent={header}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { paddingHorizontal: 20 },
  header: { paddingTop: 10, paddingBottom: 14, gap: 7 },
  back: { alignSelf: 'flex-start', paddingVertical: 4, marginLeft: -4 },
  stateLine: { fontFamily: fonts.regular, fontSize: 13.5, marginTop: 12 },
  playAll: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 9,
    borderRadius: 999,
    paddingLeft: 7,
    paddingRight: 18,
    paddingVertical: 7,
    marginTop: 10,
  },
  playDisc: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 2,
  },
  playAllText: { fontFamily: fonts.medium, fontSize: 14 },
  count: { marginTop: 10 },
  empty: { marginTop: 18, gap: 5 },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 17 },
  emptyBody: { fontFamily: fonts.regular, fontSize: 13.5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
  },
  pressed: { opacity: 0.6 },
  idx: {
    width: 22,
    fontSize: 11,
    textAlign: 'center',
    fontFamily: fonts.regular,
    fontVariant: ['tabular-nums'],
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  meta: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontFamily: fonts.medium, fontSize: 15 },
});
