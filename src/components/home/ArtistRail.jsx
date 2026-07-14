import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { PressScale } from '../ui/PressScale';
import { TrackArt } from '../TrackRow';
import { fonts, label } from '../../theme/tokens';

// "Your top artists" — round avatar tiles (avatar = the artist's most-played
// track's art; lettered fallback rides TrackArt).
export function ArtistRail({ artists, onOpen }) {
  const { t } = useTheme();
  return (
    <ScrollView overScrollMode="always"
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
    >
      {artists.slice(0, 8).map(a => (
        <PressScale
          key={a.artist}
          accessibilityRole="button"
          accessibilityLabel={a.artist}
          onPress={() => onOpen(a)}
          style={styles.tile}
        >
          <TrackArt
            track={{ ...a.sampleTrack, name: a.artist }}
            size={84}
            round
          />
          <Text numberOfLines={1} style={[styles.name, { color: t.ink }]}>
            {a.artist}
          </Text>
          <Text style={[label(8.5), { color: t.inkFaint }]}>
            {a.playCount} plays
          </Text>
        </PressScale>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  rail: { gap: 14, paddingHorizontal: 22 },
  tile: { width: 96, alignItems: 'center', gap: 5 },
  name: { fontFamily: fonts.medium, fontSize: 13, textAlign: 'center' },
});
