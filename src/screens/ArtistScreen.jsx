import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BounceScrollView } from '../components/ui/Bounce';
import { DOCK_CLEARANCE } from '../components/nav/Dock';
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
import { AuraLoader } from '../components/ui/AuraLoader';
import { usePullRefresh } from '../hooks/usePullRefresh';
import { ErrorState } from '../components/ui/ErrorState';
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

  // Lifted out of the effect so the failure can offer a retry (HistoryScreen's
  // loadFirstPage shape). Resetting to {null, null} returns the screen to
  // `loading`; an abort still never renders as an error.
  //
  // `quiet` is the pull-to-refresh mode of the SAME request (LikedScreen
  // carries the long version): no blank-to-loading on the way in, and a
  // failure re-thrown rather than written into the error state, so the artist
  // already on screen outlives a blink of network.
  const load = useCallback(
    (signal, { quiet = false } = {}) => {
      if (!quiet) {
        setHit({ data: null, error: null });
      }
      return getArtist({ id, name, trackId }, { signal })
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
    [id, name, trackId],
  );

  useEffect(() => {
    const ctl = new AbortController();
    load(ctl.signal);
    return () => ctl.abort();
  }, [load]);

  // Pull-to-refresh. This screen is a ScrollView, not a list — the control
  // rides the same prop either way, and Bounce yields the top drag to it.
  const pull = usePullRefresh(signal => load(signal, { quiet: true }));

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
      <BounceScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + DOCK_CLEARANCE },
        ]}
        refreshControl={pull.control}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.crumbRow}>
          <CrumbBack onPress={() => navigation.goBack()} />
          <Text style={[label(10), { color: t.inkFaint }]}>
            Artist
            {artist?.followerCount
              ? ` · ${artist.followerCount.toLocaleString()} fans`
              : ''}
          </Text>
        </View>

        {status === 'loading' && <AuraLoader label="Loading artist" />}
        {status === 'error' && (
          <ErrorState
            style={styles.errorBlock}
            message={`Couldn't load — ${hit.error}`}
            onRetry={() => load()}
          />
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

            {/* A successful load with nothing of this artist's own used to
                render the hero and then nothing at all, which reads as a
                broken screen. Same shape as liked/playlist. */}
            {tracks.length === 0 && albums.length === 0 && (
              <View style={styles.empty}>
                <Text style={[styles.emptyTitle, { color: t.ink }]}>
                  Nothing from this artist yet.
                </Text>
                <Text style={[styles.emptyBody, { color: t.inkSoft }]}>
                  No songs or albums in the catalogue — try searching for a
                  track name.
                </Text>
              </View>
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
                <ScrollView overScrollMode="always"
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
      </BounceScrollView>
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
  errorBlock: { marginTop: 12 },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 6,
  },
  heroName: { flexShrink: 1 },
  empty: { marginTop: 18, gap: 5 },
  emptyTitle: type.blockTitle,
  emptyBody: type.caption,
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
