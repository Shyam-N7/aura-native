import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BounceFlatList } from '../components/ui/Bounce';
import { LONG_LIST } from '../lib/listWindow';
import { DOCK_CLEARANCE } from '../components/nav/Dock';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { getCatalogPlaylist } from '../api/discover';
import { hideTrack, unhideTrack } from '../api/hidden';
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
import { ErrorState } from '../components/ui/ErrorState';
import { label, type } from '../theme/tokens';
import { useBackToTop } from '../hooks/useBackToTop';
import { usePullRefresh } from '../hooks/usePullRefresh';
import { countRender } from '../lib/renderCount';

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
                icon: 'eye-off',
                label: "Don't show this again",
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
  // __DEV__-only; stripped from release (lib/renderCount).
  countRender('CatalogPlaylistScreen');
  const backToTop = useBackToTop();
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const { id, initialData = null, ownerName = null } = route.params ?? {};
  const [hit, setHit] = useState({ data: initialData, error: null });
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';

  // Lifted out of the effect so the failure can offer a retry rather than
  // dead-ending on Back (HistoryScreen's loadFirstPage shape). Only ever runs
  // for a fetched list — a pre-loaded auto mix can't fail, so it can't retry.
  //
  // `quiet` is the pull-to-refresh mode of the SAME request (LikedScreen
  // carries the long version): no blank-to-loading on the way in, and a
  // failure re-thrown rather than written into the error state, so the rows
  // already on screen outlive a blink of network.
  const load = useCallback(
    (signal, { quiet = false } = {}) => {
      if (!quiet) {
        setHit({ data: null, error: null });
      }
      return getCatalogPlaylist(id, { signal })
        .then(data => setHit({ data, error: null }))
        .catch(err => {
          if (err.name === 'AbortError') {
            return;
          }
          if (quiet) {
            throw err;
          }
          setHit({ data: null, error: err.message });
        });
    },
    [id],
  );

  useEffect(() => {
    if (initialData) {
      return undefined; // pre-loaded (an auto mix) — no fetch
    }
    const ctl = new AbortController();
    load(ctl.signal);
    return () => ctl.abort();
  }, [initialData, load]);

  // Pull-to-refresh, on exactly the same gate as the fetch: a made-for-you
  // mix arrives whole in `initialData` and has no per-id endpoint behind it,
  // so there is nothing a pull could ask for. No control on those, and the
  // rubber band keeps the top drag it always had — an affordance that cannot
  // do anything is worse than none.
  const pull = usePullRefresh(signal => load(signal, { quiet: true }), {
    enabled: !initialData,
  });

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
  // isn't a pick of ours to apologise for). Removes the row immediately, with
  // the undo ON the toast. The hidden list is still in settings and still the
  // place to change your mind later, but the pointer is out of the copy: it
  // was there because there was nowhere else to undo, and telling someone to
  // go find a settings screen is a worse answer than the button in front of
  // them. hideTrack has an exact inverse (unhideTrack), so this undo is real:
  // it puts the row back at its own index, and the mix's order is the
  // server's and untouched by hiding, so that IS its original position.
  const isAutoMix = initialData?.kind === 'auto';

  // The row index has to come off a ref, not the deps: hideOne reaches every
  // mounted row through renderRow, and a handler that took a new identity on
  // every data change would hand all of them a new menu (the memo note at the
  // top of this file). Same shape as PlaylistScreen's hitRef.
  const hitRef = useRef(hit);
  hitRef.current = hit;

  const putRowBack = useCallback(
    (track, at) =>
      setHit(h => {
        const rows = h.data?.tracks;
        if (!rows || rows.some(x => x.id === track.id)) {
          return h;
        }
        const next = rows.slice();
        next.splice(Math.min(at, next.length), 0, track);
        return { ...h, data: { ...h.data, tracks: next } };
      }),
    [],
  );

  const unhideOne = useCallback(
    async (track, at) => {
      // putRowBack no-ops when the row is already there, so the rollback has
      // to know that too — otherwise a failed undo removes a row it never put
      // back. Read off the ref, not inside the updater, which is lazy and runs
      // twice under StrictMode.
      const already = (hitRef.current?.data?.tracks ?? []).some(
        x => x.id === track.id,
      );
      putRowBack(track, at);
      try {
        await unhideTrack(track.id);
        // Home cached a mix built WITHOUT this track; drop it again.
        invalidateHomeCache('autoPlaylists', 'quickPicks');
        showToast('Back in your mixes.');
      } catch {
        if (!already) {
          setHit(h =>
            h.data
              ? {
                  ...h,
                  data: {
                    ...h.data,
                    tracks: (h.data.tracks ?? []).filter(
                      x => x.id !== track.id,
                    ),
                  },
                }
              : h,
          );
        }
        showToast("Couldn't undo that — try again.");
      }
    },
    [putRowBack],
  );

  const hideOne = useCallback(
    async track => {
      const at = Math.max(
        0,
        (hitRef.current.data?.tracks ?? []).findIndex(x => x.id === track.id),
      );
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
        showToast("Hidden — AURA won't pick this for you again.", {
          action: { label: 'Undo', onPress: () => unhideOne(track, at) },
        });
      } catch {
        showToast("Couldn't hide that — try again.");
      }
    },
    [unhideOne],
  );

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
        refreshControl={pull.control}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.head}>
            <CrumbBack onPress={() => navigation.goBack()} />

        {status === 'loading' && <AuraLoader label="Loading playlist" />}
        {status === 'error' && (
          <ErrorState
            style={styles.errorBlock}
            message={`Couldn't load — ${hit.error}`}
            onRetry={() => load()}
          />
        )}

        {status === 'ok' && (
          <>
            {!!ownerName && (
              <Text style={[label(10), { color: t.inkFaint }]}>
                Shared by {ownerName}
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
            {/* An ok response with no tracks used to render a bare title —
                indistinguishable from a broken fetch. The filter-no-match line
                above only covers a list that HAS rows. */}
            {tracks.length === 0 && (
              <View style={styles.empty}>
                <Text style={[styles.emptyTitle, { color: t.ink }]}>
                  This playlist is empty.
                </Text>
                <Text style={[styles.emptyBody, { color: t.inkSoft }]}>
                  No songs in it right now — check back after the next refresh.
                </Text>
              </View>
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
  stateLine: { ...type.caption, marginTop: 12 },
  errorBlock: { marginTop: 12 },
  empty: { marginTop: 18, gap: 5 },
  emptyTitle: type.blockTitle,
  emptyBody: type.caption,
});
