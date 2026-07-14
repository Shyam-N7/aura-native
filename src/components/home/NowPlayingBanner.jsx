import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { PressScale } from '../ui/PressScale';
import { TrackArt } from '../TrackRow';
import { fonts, label } from '../../theme/tokens';
import { cleanTitle } from '../../utils/title';

// Now-playing hero card — tap re-opens the full player. Re-keyed by track id
// so each change fades the new title in (web MorphingAlbumArt equivalent).
export function NowPlayingBanner({ track, onOpen }) {
  const { t } = useTheme();
  if (!track) {
    return null;
  }
  return (
    <View style={styles.pad}>
      <PressScale
        accessibilityRole="button"
        accessibilityLabel="now playing, open player"
        onPress={onOpen}
        style={[
          styles.card,
          { backgroundColor: t.surface, borderColor: t.line },
        ]}
      >
        <TrackArt track={track} size={64} radius={12} />
        <Animated.View
          key={track.id}
          entering={FadeIn.duration(300)}
          style={styles.meta}
        >
          <Text style={[label(9), { color: t.accent }]}>now playing</Text>
          <Text numberOfLines={1} style={[styles.title, { color: t.ink }]}>
            {cleanTitle(track.title)}
          </Text>
          {!!track.artist && (
            <Text
              numberOfLines={1}
              style={[styles.artist, { color: t.inkSoft }]}
            >
              {track.artist}
            </Text>
          )}
        </Animated.View>
      </PressScale>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 22 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  meta: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.semibold, fontSize: 17 },
  artist: { fontFamily: fonts.regular, fontSize: 13 },
});
