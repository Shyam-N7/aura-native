import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { getAlbum } from '../api/catalog';
import {
  CrumbBack,
  PlayAllPill,
  CountLine,
  DetailRow,
} from '../components/detail/DetailChassis';
import { fonts, label, type } from '../theme/tokens';

// Album / movie detail, ported from web DesktopAlbumDetail. Indian-cinema
// soundtracks are albums with isMovie — the eyebrow names it a movie.
export default function AlbumScreen({ route, navigation }) {
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
            Loading {kind}
          </Text>
        )}
        {status === 'error' && (
          <Text style={[styles.stateLine, { color: t.inkSoft }]}>
            Couldn't load — {hit.error}
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
                <View style={styles.list}>
                  {tracks.map((track, i) => (
                    <DetailRow
                      key={track.id}
                      track={track}
                      index={i}
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
