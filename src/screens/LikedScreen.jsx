import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearTransition, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BounceFlatList } from '../components/ui/Bounce';
import { AuraLoader } from '../components/ui/AuraLoader';
import { DOCK_CLEARANCE } from '../components/nav/Dock';
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
import { LIKED_SORT_KEY, LIKED_SORTS } from '../components/detail/listSorts';
import { LONG_LIST } from '../lib/listWindow';
import { fonts, label, type } from '../theme/tokens';
import { useBackToTop } from '../hooks/useBackToTop';
import { countRender } from '../lib/renderCount';

// Full-page liked songs, ported from web DesktopLiked: hero header, count +
// total runtime, numbered rows with a heart that drops the row on unlike,
// plus find-in-list + sort (the chosen sort is remembered).
const SORT_KEY = LIKED_SORT_KEY;
const SORTS = LIKED_SORTS;

const ROW_LAYOUT = LinearTransition.duration(220).reduceMotion(
  ReduceMotion.System,
);

// One liked row, memoized.
//
// The point is not memo itself — it is that NOTHING inline is handed to a row
// any more. The previous renderItem passed `onPress={() => playFrom(index)}`
// (a fresh closure), `menu={{ omit: ['like'] }}` (a fresh object) and
// `right={<HeartButton …/>}` (a fresh element) to every row on every render.
// Any one of those defeats memo completely, so wrapping the row without fixing
// them first would have looked like a fix and changed nothing.
//
// The heart moved INSIDE here for the same reason: an element prop can never
// be shallow-equal across renders.
const ROW_MENU = { omit: ['like'] };

const LikedRow = React.memo(function LikedRow({
  track,
  index,
  highlight,
  onPlay,
  faint,
  accent,
}) {
  const press = useCallback(() => onPlay(index), [onPlay, index]);
  return (
    <DetailRow
      track={track}
      index={index}
      highlight={highlight}
      onPress={press}
      menu={ROW_MENU}
      right={
        <HeartButton trackId={track.id} size={18} color={faint} accent={accent} />
      }
    />
  );
});

export default function LikedScreen({ navigation }) {
  // __DEV__-only; stripped from release (lib/renderCount).
  countRender('LikedScreen');
  const backToTop = useBackToTop();
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const { isLiked, ready, rev } = useLikes();
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
  // Both of these used to run on EVERY render — a filter over the whole liked
  // set, then a map+join building one long string from every id. On a 200-track
  // library that is two full passes and a large string concat per render, and
  // this screen re-renders on every debounced keystroke and every sort change.
  // It is the clearest cost here that scales with list length, which is exactly
  // the reported symptom.
  //
  // `rev` is what makes these deps honest, and it is not decoration.
  //
  // This memo replaced a render-body filter, which re-ran on EVERY render —
  // including the one useLikes forces when the like-set changes. The memo's
  // first deps were [data, ready, isLiked], and the comment here argued they
  // were complete because "isLiked is module-scope, so its identity never
  // changes". That is exactly backwards: an identity that never changes can
  // never signal that the SET changed. `data` is written once by the fetch
  // effect and `ready` only moves at boot, so nothing in that list moved on an
  // unlike — the memo returned its cached array, likedKey was unchanged,
  // `shown` never recomputed, and the row stayed on screen with a hollow heart
  // while CountLine kept counting it.
  const { data } = hit;
  const liked = useMemo(
    () => (data ?? []).filter(x => !ready || isLiked(x.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, ready, isLiked, rev],
  );
  const likedKey = useMemo(() => liked.map(x => x.id).join(','), [liked]);
  const shown = useMemo(
    () => sortTracks(filterTracks(liked, query), sort),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [likedKey, query, sort],
  );

  // Play what's on screen: a filtered or re-sorted view queues in that order.
  // Stable, so the memoized row below is not invalidated on every render.
  // shownRef rather than a `shown` dep: the callback must see the CURRENT list
  // when tapped, without changing identity every time the list does.
  // playerRef for the same reason: the context value takes a new identity on
  // every track advance and every play/pause, so depending on it here handed
  // the rows a new onPlay each time — which is exactly what the memo above
  // exists to prevent.
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const playerRef = useRef(player);
  playerRef.current = player;
  const playFrom = useCallback(i => {
    playerRef.current.playQueue(shownRef.current, i, 'your liked');
    playerRef.current.ui?.openPlayer?.();
  }, []);

  const header = (
    <View style={styles.header}>
      <CrumbBack onPress={() => navigation.goBack()} />
      {status === 'loading' && <AuraLoader label="Loading liked songs" />}
      {status === 'error' && (
        <Text style={[styles.stateLine, { color: t.inkSoft }]}>
          Couldn't load — {hit.error}
        </Text>
      )}
      {status === 'ok' && (
        <>
          <Text style={[label(9.5), { color: t.inkFaint }]}>
            Your collection
          </Text>
          <Text style={[type.queueHero, { color: t.ink }]}>Liked</Text>
          {liked.length > 0 && (
            <Text style={[label(9.5), { color: t.inkSoft }]}>By you</Text>
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
  const renderItem = useCallback(
    ({ item, index }) => (
      <LikedRow
        track={item}
        index={index}
        highlight={query}
        onPlay={playFrom}
        faint={t.inkFaint}
        accent={t.accent}
      />
    ),
    [query, playFrom, t.inkFaint, t.accent],
  );

  return (
    <View
      style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}
    >
      <BounceFlatList
        {...backToTop}
        data={status === 'ok' ? shown : []}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        itemLayoutAnimation={ROW_LAYOUT}
        ListHeaderComponent={header}
        {...LONG_LIST}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + DOCK_CLEARANCE },
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
