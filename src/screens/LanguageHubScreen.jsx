import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BounceScrollView } from '../components/ui/Bounce';
import { DOCK_CLEARANCE } from '../components/nav/Dock';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { getDiscoverHome } from '../api/discover';
import { PlaylistGrid } from '../components/home/PlaylistGrid';
import {
  CrumbBack,
  DetailSection,
} from '../components/detail/DetailChassis';
import { AuraLoader } from '../components/ui/AuraLoader';
import { fonts, label, type } from '../theme/tokens';
import { artUrl } from '../utils/artUrl';
import { cleanTitle } from '../utils/title';

// Per-language discovery hub, ported from web DesktopLanguageHub: five
// shelves (trending / top hits / popular playlists / classics / from the
// movies), each hidden when empty. Track tiles play that single track live;
// playlist tiles open the catalog playlist.
export default function LanguageHubScreen({ route, navigation }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const { lang } = route.params ?? {};
  const [hit, setHit] = useState({ data: null, error: null });
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';

  useEffect(() => {
    const ctl = new AbortController();
    getDiscoverHome({ lang, signal: ctl.signal })
      .then(data => setHit({ data, error: null }))
      .catch(err => {
        if (err.name !== 'AbortError') {
          setHit({ data: null, error: err.message });
        }
      });
    return () => ctl.abort();
  }, [lang]);

  const trending = hit.data?.trending ?? [];
  const playlists = hit.data?.popularPlaylists ?? [];
  const topHits = hit.data?.topHits ?? [];
  const classics = hit.data?.classics ?? [];
  const movies = hit.data?.movieSongs ?? [];
  const anyContent =
    trending.length ||
    playlists.length ||
    topHits.length ||
    classics.length ||
    movies.length;

  const langTitle = lang ? lang.charAt(0).toUpperCase() + lang.slice(1) : '';

  const pickLive = track => {
    player.playTrack(track, { source: 'your pick' });
    player.ui?.openPlayer?.();
  };

  const trackItems = tracks =>
    tracks.slice(0, 8).map(track => ({
      id: track.id,
      name: cleanTitle(track.title),
      cover: artUrl(track, 500),
      meta: (track.artist ?? '').toLowerCase(),
      track,
    }));

  const trackShelf = (title, sub, tracks) =>
    tracks.length > 0 && (
      <View key={title}>
        <DetailSection title={title} sub={sub} />
        <PlaylistGrid
          style={styles.gridFlush}
          items={trackItems(tracks)}
          onPressItem={item => pickLive(item.track)}
        />
      </View>
    );

  return (
    <View
      style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}
    >
      <BounceScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + DOCK_CLEARANCE },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.crumbRow}>
          <CrumbBack onPress={() => navigation.goBack()} />
          <Text style={[label(10), { color: t.inkFaint }]}>
            Browse · {lang}
          </Text>
        </View>
        <Text style={[type.queueHero, { color: t.ink }]}>{lang}.</Text>

        {status === 'loading' && <AuraLoader label={`Loading ${lang}`} />}
        {status === 'error' && (
          <Text style={[styles.stateLine, { color: t.inkSoft }]}>
            Couldn't load — {hit.error}
          </Text>
        )}
        {status === 'ok' && !anyContent && (
          <Text style={[styles.stateLine, { color: t.inkSoft }]}>
            Nothing here yet for {langTitle}.
          </Text>
        )}

        {status === 'ok' && (
          <>
            {trackShelf(
              'Trending',
              `Popular in ${langTitle} right now`,
              trending,
            )}
            {trackShelf('Top hits', `What's playing in ${langTitle}`, topHits)}
            {playlists.length > 0 && (
              <View>
                <DetailSection
                  title="Popular playlists"
                  sub={`Curated for ${langTitle}`}
                />
                <PlaylistGrid
                  style={styles.gridFlush}
                  items={playlists.slice(0, 8).map(p => ({
                    id: p.id,
                    name: p.name,
                    cover: p.coverImageUrl,
                    meta: p.subtitle?.toLowerCase(),
                  }))}
                  onPressItem={item =>
                    navigation.push('CatalogPlaylist', { id: item.id })
                  }
                />
              </View>
            )}
            {trackShelf('Classics', `Timeless ${langTitle} songs`, classics)}
            {trackShelf(
              'From the movies',
              `Recent ${langTitle} film soundtracks`,
              movies,
            )}
            {!!anyContent && (
              <Text style={[label(9), styles.footer, { color: t.inkFaint }]}>
                — End of {lang} —
              </Text>
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
  stateLine: { fontFamily: fonts.regular, fontSize: 13.5, marginTop: 12 },
  gridFlush: { paddingHorizontal: 0 },
  footer: { textAlign: 'center', marginTop: 30 },
});
