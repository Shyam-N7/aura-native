import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BounceScrollView } from '../components/ui/Bounce';
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
import { fonts, label, type } from '../theme/tokens';

// Read-only playlist detail, ported from web DesktopCatalogPlaylistDetail.
// Serves catalog/editorial playlists (fetched by id) AND auto "made for you"
// mixes, which already carry their full tracks in memory — passed via the
// `initialData` route param to skip the fetch (auto mixes have no per-id GET).
// The auto-mix "don't show this again" action arrives with the context menu.
// Find-in-list + sort ride above the rows; the chosen sort is remembered.
const SORT_KEY = 'aura.sortPlaylist';
const SORTS = [
  { id: 'default', label: 'in order' },
  { id: 'title', label: 'title' },
  { id: 'artist', label: 'artist' },
  { id: 'longest', label: 'longest' },
];

export default function CatalogPlaylistScreen({ route, navigation }) {
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
  const hideOne = async track => {
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
  };

  // Play what's on screen: a filtered or re-sorted view queues in that order.
  const playFrom = i => {
    player.playQueue(
      shown,
      i,
      (hit.data?.name ?? 'this playlist').toLowerCase(),
    );
    player.ui?.openPlayer?.();
  };

  return (
    <View
      style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}
    >
      <BounceScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 24 },
        ]}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <CrumbBack onPress={() => navigation.goBack()} />

        {status === 'loading' && (
          <Text style={[styles.stateLine, { color: t.inkFaint }]}>
            Loading playlist
          </Text>
        )}
        {status === 'error' && (
          <Text style={[styles.stateLine, { color: t.inkSoft }]}>
            Couldn't load — {hit.error}
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
                <View style={styles.list}>
                  {shown.map((track, i) => (
                    <DetailRow
                      key={track.id}
                      track={track}
                      index={i}
                      highlight={query}
                      reason={track.reason}
                      onPress={() => playFrom(i)}
                      menu={{
                        extras: isAutoMix
                          ? [
                              {
                                label: "don't show this again",
                                danger: true,
                                onPress: () => hideOne(track),
                              },
                            ]
                          : [],
                      }}
                    />
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </BounceScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 10, gap: 7 },
  stateLine: { fontFamily: fonts.regular, fontSize: 13.5, marginTop: 12 },
  list: { marginTop: 8 },
});
