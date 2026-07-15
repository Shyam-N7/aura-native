import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearTransition, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BounceFlatList } from '../components/ui/Bounce';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { listLiked } from '../api/likes';
import { useLikes } from '../hooks/useLikes';
import { storage } from '../storage/mmkv';
import { filterTracks, sortTracks } from '../lib/listFilter';
import { HeartButton } from '../components/player/HeartButton';
import {
  CrumbBack,
  PlayAllPill,
  CountLine,
  DetailRow,
} from '../components/detail/DetailChassis';
import { ListTools } from '../components/detail/ListTools';
import { fonts, label, type } from '../theme/tokens';

// Full-page liked songs, ported from web DesktopLiked: hero header, count +
// total runtime, numbered rows with a heart that drops the row on unlike,
// plus find-in-list + sort (the chosen sort is remembered).
const SORT_KEY = 'aura.sortLiked';
const SORTS = [
  { id: 'default', label: 'recent' },
  { id: 'title', label: 'title' },
  { id: 'artist', label: 'artist' },
  { id: 'longest', label: 'longest' },
];

const ROW_LAYOUT = LinearTransition.duration(220).reduceMotion(
  ReduceMotion.System,
);

export default function LikedScreen({ navigation }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const { isLiked, ready } = useLikes();
  const [hit, setHit] = useState({ data: null, error: null });
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';

  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(
    () => storage.getItem(SORT_KEY) ?? 'default',
  );

  // Debounce the filter a beat so fast typing re-renders once, not per key.
  useEffect(() => {
    const id = setTimeout(() => setQuery(input), 150);
    return () => clearTimeout(id);
  }, [input]);

  const pickSort = id => {
    setSort(id);
    storage.setItem(SORT_KEY, id);
  };

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
  const likedKey = liked.map(x => x.id).join(',');
  const shown = useMemo(
    () => sortTracks(filterTracks(liked, query), sort),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [likedKey, query, sort],
  );

  // Play what's on screen: a filtered or re-sorted view queues in that order.
  const playFrom = i => {
    player.playQueue(shown, i, 'your liked');
    player.ui?.openPlayer?.();
  };

  const header = (
    <View style={styles.header}>
      <CrumbBack onPress={() => navigation.goBack()} />
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
            <PlayAllPill text="Play all" onPress={() => playFrom(0)} />
          )}
          {liked.length > 0 && <CountLine tracks={liked} noun="song" />}
          {liked.length > 0 && (
            <ListTools
              query={input}
              onQuery={setInput}
              sort={sort}
              onSort={pickSort}
              sorts={SORTS}
            />
          )}
          {liked.length > 0 && query.trim() !== '' && shown.length === 0 && (
            <Text style={[styles.stateLine, { color: t.inkSoft }]}>
              No matches for "{query.trim()}".
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

  // The heart handles like/unlike, so the menu omits it (web parity).
  const renderItem = ({ item, index }) => (
    <DetailRow
      track={item}
      index={index}
      highlight={query}
      onPress={() => playFrom(index)}
      menu={{ omit: ['like'] }}
      right={
        <HeartButton
          trackId={item.id}
          size={18}
          color={t.inkFaint}
          accent={t.accent}
        />
      }
    />
  );

  return (
    <View
      style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}
    >
      <BounceFlatList
        data={status === 'ok' ? shown : []}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        itemLayoutAnimation={ROW_LAYOUT}
        ListHeaderComponent={header}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
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
  stateLine: { fontFamily: fonts.regular, fontSize: 13.5, marginTop: 12 },
  empty: { marginTop: 18, gap: 5 },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 17 },
  emptyBody: { fontFamily: fonts.regular, fontSize: 13.5 },
});
