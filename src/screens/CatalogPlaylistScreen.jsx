import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { getCatalogPlaylist } from '../api/discover';
import {
  CrumbBack,
  PlayAllPill,
  CountLine,
  DetailRow,
} from '../components/detail/DetailChassis';
import { fonts, label, type } from '../theme/tokens';

// Read-only playlist detail, ported from web DesktopCatalogPlaylistDetail.
// Serves catalog/editorial playlists (fetched by id) AND auto "made for you"
// mixes, which already carry their full tracks in memory — passed via the
// `initialData` route param to skip the fetch (auto mixes have no per-id GET).
// The auto-mix "don't show this again" action arrives with the context menu.
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

  const tracks = hit.data?.tracks ?? [];

  const playFrom = i => {
    player.playQueue(
      tracks,
      i,
      (hit.data?.name ?? 'this playlist').toLowerCase(),
    );
    player.ui?.openPlayer?.();
  };

  return (
    <View
      style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 24 },
        ]}
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
                <View style={styles.list}>
                  {tracks.map((track, i) => (
                    <DetailRow
                      key={track.id}
                      track={track}
                      index={i}
                      reason={track.reason}
                      onPress={() => playFrom(i)}
                    />
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 10, gap: 7 },
  stateLine: { fontFamily: fonts.regular, fontSize: 13.5, marginTop: 12 },
  list: { marginTop: 8 },
});
