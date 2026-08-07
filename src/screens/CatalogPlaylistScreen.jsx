import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BounceFlatList } from '../components/ui/Bounce';
import { LONG_LIST } from '../lib/listWindow';
import { DOCK_CLEARANCE } from '../components/nav/Dock';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { getCatalogPlaylist } from '../api/discover';
import { hideTrack } from '../api/hidden';
import { invalidateHomeCache } from '../lib/homeCache';
import { showToast } from '../lib/toast';
import { storage } from '../storage/mmkv';
import { filterTracks, sortTracks } from '../lib/listFilter';
import {
  CrumbBack,
  PlayAllPill,
  CountLine,
  DetailRow,
} from '../components/detail/DetailChassis';
import { ListTools } from '../components/detail/ListTools';
import { PLAYLIST_SORT_KEY, PLAYLIST_SORTS } from '../components/detail/listSorts';
import { AuraLoader } from '../components/ui/AuraLoader';
import { fonts, label, type } from '../theme/tokens';
import { useBackToTop } from '../hooks/useBackToTop';

// Read-only playlist detail, ported from web DesktopCatalogPlaylistDetail.
// Serves catalog/editorial playlists (fetched by id) AND auto "made for you"
// mixes, which already carry their full tracks in memory — passed via the
// `initialData` route param to skip the fetch (auto mixes have no per-id GET).
// The auto-mix "don't show this again" action arrives with the context menu.
// Find-in-list + sort ride above the rows; the chosen sort is remembered.
// Shared with PlaylistScreen — same key, so necessarily the same list.
const SORT_KEY = PLAYLIST_SORT_KEY;
const SORTS = PLAYLIST_SORTS;

// Nothing inline reaches a row. DetailRow is React.memo'd, and a fresh closure
// (`onPress={() => playFrom(i)}`), a fresh object (the `menu={{extras: …}}`
// literal) or a renderItem redefined in the render body each defeats that
// compare on its own. Same shape as LikedScreen.
const ROW_MENU = { extras: [] };

const CatalogRow = React.memo(function CatalogRow({
  track,
  index,
  highlight,
  onPlay,
  onHide,
}) {
  const press = useCallback(() => onPlay(index), [onPlay, index]);
  const menu = useMemo(
    () =>
      onHide
        ? {
            extras: [
              {
                label: "don't show this again",
                danger: true,
                onPress: () => onHide(track),
              },
            ],
          }
        : ROW_MENU,
    [onHide, track],
  );
  return (
    <DetailRow
      track={track}
      index={index}
      highlight={highlight}
      reason={track.reason}
      onPress={press}
      menu={menu}
    />
  );
});

export default function CatalogPlaylistScreen({ route, navigation }) {
  const backToTop = useBackToTop();
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const { id, initialData = null, ownerName = null } = route.params ?? {};
  const [hit, setHit] = useState({ data: initialData, error: null });
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';

  useEffect(() => {
    if (initialData) {
      return undefined; // pre-loaded (an auto mix) — no fetch
    }
    const ctl = new AbortController();
    getCatalogPlaylist(id, { signal: ctl.signal })
      .then(data => setHit({ data, error: null }))
      .catch(err => {
        if (err.name !== 'AbortError') {
          setHit({ data: null, error: err.message });
        }
      });
    return () => ctl.abort();
  }, [id, initialData]);

  const tracks = useMemo(() => hit.data?.tracks ?? [], [hit.data]);

  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(
    () => storage.getItem(SORT_KEY) ?? 'default',
  );

  // Debounce the filter a beat so fast typing re-renders once, not per key.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input), 150);
    return () => clearTimeout(timer);
  }, [input]);

  const pickSort = sortId => {
    setSort(sortId);
    storage.setItem(SORT_KEY, sortId);
  };

  const shown = useMemo(
    () => sortTracks(filterTracks(tracks, query), sort),
    [tracks, query, sort],
  );

  // "Don't show this again" — only on the made-for-you mixes (a catalog list
  // isn't a pick of ours to apologise for). Removes the row immediately; the
  // undo lives in the library's settings shelf.
  const isAutoMix = initialData?.kind === 'auto';
  const hideOne = useCallback(async track => {
    try {
      await hideTrack(track.id);
      setHit(h =>
        h.data
          ? {
              ...h,
              data: {
                ...h.data,
                tracks: (h.data.tracks ?? []).filter(x => x.id !== track.id),
              },
            }
          : h,
      );
      // Home must not serve it again this session.
      invalidateHomeCache('autoPlaylists', 'quickPicks');
      showToast("hidden — aura won't pick this for you again. undo in settings.");
    } catch {
      showToast("couldn't hide that — try again.");
    }
  }, []);

  // Play what's on screen: a filtered or re-sorted view queues in that order.
  //
  // shownRef / playerRef rather than deps: both change on things that must not
  // reach the rows — `shown` on every keystroke, the player value on every
  // track advance — and this only ever runs on a tap, so it must read the
  // CURRENT values without taking a new identity when they move.
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const playerRef = useRef(player);
  playerRef.current = player;
  const source = (hit.data?.name ?? 'this playlist').toLowerCase();
  const playFrom = useCallback(
    i => {
      playerRef.current.playQueue(shownRef.current, i, source);
      playerRef.current.ui?.openPlayer?.();
    },
    [source],
  );

  // Rows are windowed FlatList data — catalog playlists run to hundreds of
  // tracks, and mounting them all on open (the old ScrollView map) is the
  // measured OOM-kill spike. Everything above the rows rides as the header.
  const renderRow = useCallback(
    ({ item: track, index: i }) => (
      <CatalogRow
        track={track}
        index={i}
        highlight={query}
        onPlay={playFrom}
        onHide={isAutoMix ? hideOne : null}
      />
    ),
    [query, playFrom, isAutoMix, hideOne],
  );

  return (
    <View
      style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}
    >
      <BounceFlatList
        {...backToTop}
        data={status === 'ok' ? shown : []}
        renderItem={renderRow}
        keyExtractor={item => item.id}
        {...LONG_LIST}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + DOCK_CLEARANCE },
        ]}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.head}>
            <CrumbBack onPress={() => navigation.goBack()} />

        {status === 'loading' && <AuraLoader label="loading playlist" />}
        {status === 'error' && (
          <Text style={[styles.stateLine, { color: t.inkSoft }]}>
            couldn't load — {hit.error}
          </Text>
        )}

        {status === 'ok' && (
          <>
            {!!ownerName && (
              <Text style={[label(10), { color: t.inkFaint }]}>
                shared by {ownerName}
              </Text>
            )}
            <Text style={[type.queueHero, { color: t.ink }]}>
              {hit.data.name}.
            </Text>
            {!!initialData?.editionLabel && (
              <Text style={[label(9.5), { color: t.inkFaint }]}>
                {initialData.editionLabel}
                {initialData.refreshing ? ' · refreshing…' : ''} —{' '}
                {initialData.description}
              </Text>
            )}
            {!!initialData?.ruleLine && (
              <Text style={[label(8.5), { color: t.inkFaint }]}>
                {initialData.ruleLine}
              </Text>
            )}
            {tracks.length > 0 && (
              <>
                <PlayAllPill text="Play all" onPress={() => playFrom(0)} />
                <CountLine tracks={tracks} />
                <ListTools
                  query={input}
                  onQuery={setInput}
                  sort={sort}
                  onSort={pickSort}
                  sorts={SORTS}
                />
                {query.trim() !== '' && shown.length === 0 && (
                  <Text style={[styles.stateLine, { color: t.inkSoft }]}>
                    No matches for "{query.trim()}".
                  </Text>
                )}
              </>
            )}
          </>
        )}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 10 },
  // The old content gap, scoped to the header block so it can't leak 7px
  // seams between the windowed rows; marginBottom keeps the old
  // ListTools→first-row breathing room (styles.list's marginTop).
  head: { gap: 7, marginBottom: 8 },
  stateLine: { fontFamily: fonts.regular, fontSize: 13.5, marginTop: 12 },
});
