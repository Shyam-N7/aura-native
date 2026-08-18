import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { countRender } from '../lib/renderCount';

// Nothing inline reaches a row. DetailRow is React.memo'd, and a fresh closure
// (`onPress={() => playFrom(i)}`), a fresh object (`menu={{}}`) or a renderItem
// redefined in the render body each defeats that compare on its own — so the
// memo sat there earning nothing. Same shape as LikedScreen.
const ROW_MENU = {};

const AlbumRow = React.memo(function AlbumRow({ track, index, onPlay }) {
  const press = useCallback(() => onPlay(index), [onPlay, index]);
  return (
    <DetailRow track={track} index={index} onPress={press} menu={ROW_MENU} />
  );
});

// Album / movie detail, ported from web DesktopAlbumDetail. Indian-cinema
// soundtracks are albums with isMovie — the eyebrow names it a movie.
export default function AlbumScreen({ route, navigation }) {
  // __DEV__-only; stripped from release (lib/renderCount).
  countRender('AlbumScreen');
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

  // Memoized because this is the list's `data`. A fresh `[]`/slice every render
  // is a new identity to VirtualizedList, which re-renders every mounted cell.
  const tracks = useMemo(() => hit.data?.tracks ?? [], [hit.data]);
  const kind = hit.data?.isMovie ? 'movie' : 'album';
  // Multiple artists arrive as a comma-joined string — show only the main one.
  const mainArtist = (hit.data?.artist ?? '').split(',')[0].trim();

  // The player context value changes on every track advance and every
  // play/pause. Depending on it here would hand the rows a new onPlay each
  // time — the exact thing this batch is removing — and the callback only ever
  // runs on a tap, so a ref is the honest dependency.
  const playerRef = useRef(player);
  playerRef.current = player;
  const source = (hit.data?.name ?? `this ${kind}`).toLowerCase();
  const playFrom = useCallback(
    i => {
      playerRef.current.playQueue(tracks, i, source);
      playerRef.current.ui?.openPlayer?.();
    },
    [tracks, source],
  );

  const renderRow = useCallback(
    ({ item: track, index: i }) => (
      <AlbumRow track={track} index={i} onPlay={playFrom} />
    ),
    [playFrom],
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

            {status === 'loading' && <AuraLoader label={`Loading ${kind}`} />}
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
                    By {mainArtist}
                  </Text>
                )}
                {tracks.length > 0 && (
                  <>
                    <PlayAllPill text="Play all" onPress={() => playFrom(0)} />
                    <CountLine tracks={tracks} />
                  </>
                )}
                {/* A successful load with no tracks used to render the hero and
                    then nothing at all, which reads as a broken screen rather
                    than an empty release. Same shape as liked/playlist. */}
                {tracks.length === 0 && (
                  <View style={styles.empty}>
                    <Text style={[styles.emptyTitle, { color: t.ink }]}>
                      No tracks in this {kind} yet.
                    </Text>
                    <Text style={[styles.emptyBody, { color: t.inkSoft }]}>
                      Nothing here to play — try another release from this
                      artist.
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
  // CountLine→first-row breathing room (styles.list's marginTop).
  head: { gap: 7, marginBottom: 8 },
  stateLine: { fontFamily: fonts.regular, fontSize: 13.5, marginTop: 12 },
  empty: { marginTop: 18, gap: 5 },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 17 },
  emptyBody: { fontFamily: fonts.regular, fontSize: 13.5 },
});
