import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BounceFlatList } from '../components/ui/Bounce';
import { DOCK_CLEARANCE } from '../components/nav/Dock';
import { LONG_LIST } from '../lib/listWindow';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { getAlbum } from '../api/catalog';
import {
  CrumbBack,
  PlayAllPill,
  CountLine,
  DetailRow,
} from '../components/detail/DetailChassis';
import { AuraLoader } from '../components/ui/AuraLoader';
import { fonts, label, type } from '../theme/tokens';
import { useBackToTop } from '../hooks/useBackToTop';

// Album / movie detail, ported from web DesktopAlbumDetail. Indian-cinema
// soundtracks are albums with isMovie — the eyebrow names it a movie.
export default function AlbumScreen({ route, navigation }) {
  const backToTop = useBackToTop();
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const { id } = route.params ?? {};
  const [hit, setHit] = useState({ data: null, error: null });
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';

  useEffect(() => {
    const ctl = new AbortController();
    getAlbum(id, { signal: ctl.signal })
      .then(data => setHit({ data, error: null }))
      .catch(err => {
        if (err.name !== 'AbortError') {
          setHit({ data: null, error: err.message });
        }
      });
    return () => ctl.abort();
  }, [id]);

  const tracks = hit.data?.tracks ?? [];
  const kind = hit.data?.isMovie ? 'movie' : 'album';
  // Multiple artists arrive as a comma-joined string — show only the main one.
  const mainArtist = (hit.data?.artist ?? '').split(',')[0].trim();

  const playFrom = i => {
    player.playQueue(tracks, i, (hit.data?.name ?? `this ${kind}`).toLowerCase());
    player.ui?.openPlayer?.();
  };

  const renderRow = ({ item: track, index: i }) => (
    <DetailRow track={track} index={i} onPress={() => playFrom(i)} menu={{}} />
  );

  return (
    <View
      style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}
    >
      {/* Windowed, like every other track list in the app. This screen used to
          map the whole tracklist into a plain ScrollView, mounting a TrackArt
          image per row with no cap from the server — the one detail screen the
          list-window treatment never reached. */}
      <BounceFlatList
        {...backToTop}
        data={status === 'ok' ? tracks : []}
        renderItem={renderRow}
        keyExtractor={item => item.id}
        {...LONG_LIST}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + DOCK_CLEARANCE },
        ]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.head}>
            <CrumbBack onPress={() => navigation.goBack()} />

            {status === 'loading' && <AuraLoader label={`loading ${kind}`} />}
            {status === 'error' && (
              <Text style={[styles.stateLine, { color: t.inkSoft }]}>
                couldn't load — {hit.error}
              </Text>
            )}

            {status === 'ok' && (
              <>
                <Text style={[label(9.5), { color: t.inkFaint }]}>{kind}</Text>
                <Text style={[type.queueHero, { color: t.ink }]}>
                  {hit.data.name}
                </Text>
                {!!mainArtist && (
                  <Text style={[label(9.5), { color: t.inkSoft }]}>
                    by {mainArtist}
                  </Text>
                )}
                {tracks.length > 0 && (
                  <>
                    <PlayAllPill text="Play all" onPress={() => playFrom(0)} />
                    <CountLine tracks={tracks} />
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
  // CountLine→first-row breathing room (styles.list's marginTop).
  head: { gap: 7, marginBottom: 8 },
  stateLine: { fontFamily: fonts.regular, fontSize: 13.5, marginTop: 12 },
});
