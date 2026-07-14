import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { getArtist } from '../api/artists';
import { TrackArt } from '../components/TrackRow';
import { PressScale } from '../components/ui/PressScale';
import { PlaylistGrid } from '../components/home/PlaylistGrid';
import {
  CrumbBack,
  PlayAllPill,
  DetailSection,
  DetailRow,
} from '../components/detail/DetailChassis';
import { fonts, label, type } from '../theme/tokens';

// Artist page, ported from web DesktopArtist: identity hero, top tracks,
// discography, similar artists, bio. Opened by id (search/similar tiles) or
// name+trackId (top-artists rail, context menu) — the server resolves both.
// Web collapses artist→artist chains into one back step; native uses a real
// stack instead, so back walks the chain — the platform-native behavior.
export default function ArtistScreen({ route, navigation }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const { id, name, trackId } = route.params ?? {};
  const [hit, setHit] = useState({ data: null, error: null });
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';

  useEffect(() => {
    const ctl = new AbortController();
    getArtist({ id, name, trackId }, { signal: ctl.signal })
      .then(data => setHit({ data, error: null }))
      .catch(err => {
        if (err.name !== 'AbortError') {
          setHit({ data: null, error: err.message });
        }
      });
    return () => ctl.abort();
  }, [id, name, trackId]);

  const artist = hit.data;
  const tracks = artist?.topTracks ?? [];
  const albums = artist?.topAlbums ?? [];
  const similar = artist?.similarArtists ?? [];

  const playTop = i => {
    player.playQueue(tracks, i, `${artist.name.toLowerCase()} · top tracks`);
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
        <View style={styles.crumbRow}>
          <CrumbBack onPress={() => navigation.goBack()} />
          <Text style={[label(10), { color: t.inkFaint }]}>
            artist
            {artist?.followerCount
              ? ` · ${artist.followerCount.toLocaleString()} fans`
              : ''}
          </Text>
        </View>

        {status === 'loading' && (
          <Text style={[styles.stateLine, { color: t.inkFaint }]}>
            Loading artist
          </Text>
        )}
        {status === 'error' && (
          <Text style={[styles.stateLine, { color: t.inkSoft }]}>
            Couldn't find that artist — {hit.error}
          </Text>
        )}

        {status === 'ok' && (
          <>
            <View style={styles.heroRow}>
              <TrackArt
                track={{ title: artist.name, imageUrl: artist.image }}
                size={72}
                round
              />
              <Text style={[type.queueHero, styles.heroName, { color: t.ink }]}>
                {artist.name.toLowerCase()}.
              </Text>
            </View>
            {tracks.length > 0 && (
              <PlayAllPill text="Play top tracks" onPress={() => playTop(0)} />
            )}

            {tracks.length > 0 && (
              <>
                <DetailSection
                  title="Top tracks"
                  sub="Most-played from this artist"
                />
                {tracks.slice(0, 10).map((track, i) => (
                  <DetailRow
                    key={track.id}
                    track={track}
                    index={i}
                    sub={`${(track.album ?? '').toLowerCase()}${
                      track.language ? ` · ${track.language}` : ''
                    }`}
                    onPress={() => playTop(i)}
                    menu={{ omit: ['artist'] }}
                  />
                ))}
              </>
            )}

            {albums.length > 0 && (
              <>
                <DetailSection
                  title="Albums"
                  sub={`${albums.length} ${
                    albums.length === 1 ? 'release' : 'releases'
                  }`}
                />
                <PlaylistGrid
                  style={styles.gridFlush}
                  items={albums.map(album => ({
                    id: album.id,
                    name: album.name,
                    cover: album.image,
                    meta: album.year,
                  }))}
                  onPressItem={item => navigation.push('Album', { id: item.id })}
                />
              </>
            )}

            {similar.length > 0 && (
              <>
                <DetailSection title="Fans also like" sub="Similar artists" />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.similarRail}
                >
                  {similar.slice(0, 8).map(s => (
                    <PressScale
                      key={s.id}
                      accessibilityRole="button"
                      accessibilityLabel={s.name}
                      onPress={() =>
                        navigation.push('Artist', { id: s.id, name: s.name })
                      }
                      style={styles.similarTile}
                    >
                      <TrackArt
                        track={{ title: s.name, imageUrl: s.image }}
                        size={84}
                        round
                      />
                      <Text
                        numberOfLines={1}
                        style={[styles.similarName, { color: t.ink }]}
                      >
                        {(s.name ?? '').toLowerCase()}
                      </Text>
                    </PressScale>
                  ))}
                </ScrollView>
              </>
            )}

            {!!artist.bio && (
              <>
                <DetailSection title="About" />
                <Text style={[styles.bio, { color: t.inkSoft }]}>
                  {artist.bio}
                </Text>
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
  content: { paddingHorizontal: 20, paddingTop: 10 },
  crumbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  stateLine: { fontFamily: fonts.regular, fontSize: 13.5, marginTop: 12 },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 6,
  },
  heroName: { flexShrink: 1 },
  gridFlush: { paddingHorizontal: 0 },
  similarRail: { gap: 14 },
  similarTile: { width: 96, alignItems: 'center', gap: 5 },
  similarName: {
    fontFamily: fonts.medium,
    fontSize: 13,
    textAlign: 'center',
  },
  bio: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 20 },
});
