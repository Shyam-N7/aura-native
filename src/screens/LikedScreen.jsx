import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { listLiked } from '../api/likes';
import { useLikes } from '../hooks/useLikes';
import { HeartButton } from '../components/player/HeartButton';
import {
  CrumbBack,
  PlayAllPill,
  CountLine,
  DetailRow,
} from '../components/detail/DetailChassis';
import { fonts, label, type } from '../theme/tokens';

// Full-page liked songs, ported from web DesktopLiked: hero header, count +
// total runtime, numbered rows with a heart that drops the row on unlike.
export default function LikedScreen({ navigation }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const { isLiked, ready } = useLikes();
  const [hit, setHit] = useState({ data: null, error: null });
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';

  useEffect(() => {
    const ctl = new AbortController();
    listLiked({ signal: ctl.signal })
      .then(data => setHit({ data, error: null }))
      .catch(err => {
        if (err.name !== 'AbortError') {
          setHit({ data: null, error: err.message });
        }
      });
    return () => ctl.abort();
  }, []);

  // Show the server's liked list, dropping a row the moment it's unliked here.
  // Guard on `ready`: until the client like-set has booted, isLiked() is empty
  // and would hide everything (the "liked looks empty" race).
  const liked = (hit.data ?? []).filter(x => !ready || isLiked(x.id));

  const playFrom = i => {
    player.playQueue(liked, i, 'your liked');
    player.ui?.openPlayer?.();
  };

  const header = (
    <View style={styles.header}>
      <CrumbBack onPress={() => navigation.goBack()} />
      {status === 'loading' && (
        <Text style={[styles.stateLine, { color: t.inkFaint }]}>
          Loading liked songs
        </Text>
      )}
      {status === 'error' && (
        <Text style={[styles.stateLine, { color: t.inkSoft }]}>
          Couldn't load — {hit.error}
        </Text>
      )}
      {status === 'ok' && (
        <>
          <Text style={[label(9.5), { color: t.inkFaint }]}>
            your collection
          </Text>
          <Text style={[type.queueHero, { color: t.ink }]}>liked</Text>
          {liked.length > 0 && (
            <Text style={[label(9.5), { color: t.inkSoft }]}>by you</Text>
          )}
          {liked.length > 0 && (
            <PlayAllPill text="Play all" onPress={() => playFrom(0)} />
          )}
          {liked.length > 0 && <CountLine tracks={liked} noun="song" />}
          {liked.length === 0 && (
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: t.ink }]}>
                No liked songs yet.
              </Text>
              <Text style={[styles.emptyBody, { color: t.inkSoft }]}>
                Tap the heart on any song to start your collection.
              </Text>
            </View>
          )}
        </>
      )}
    </View>
  );

  const renderItem = ({ item, index }) => (
    <DetailRow
      track={item}
      index={index}
      onPress={() => playFrom(index)}
      right={
        <HeartButton
          trackId={item.id}
          size={18}
          color={t.inkFaint}
          accent={t.accent}
        />
      }
    />
  );

  return (
    <View
      style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}
    >
      <FlatList
        data={status === 'ok' ? liked : []}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        ListHeaderComponent={header}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { paddingHorizontal: 20 },
  header: { paddingTop: 10, paddingBottom: 14, gap: 7 },
  stateLine: { fontFamily: fonts.regular, fontSize: 13.5, marginTop: 12 },
  empty: { marginTop: 18, gap: 5 },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 17 },
  emptyBody: { fontFamily: fonts.regular, fontSize: 13.5 },
});
