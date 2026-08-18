import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { PressScale } from '../ui/PressScale';
import { TrackArt } from '../TrackRow';
import { fonts, label, type } from '../../theme/tokens';
import { cleanTitle } from '../../utils/title';

// "Recently played" memory tiles (web shows the first 3 as a horizontal rail).
export function MemoryRail({ tracks, onPick }) {
  const { t } = useTheme();
  return (
    <ScrollView overScrollMode="always"
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
    >
      {tracks.slice(0, 3).map(track => (
        <PressScale
          key={track.id}
          accessibilityRole="button"
          accessibilityLabel={`play ${cleanTitle(track.title)}`}
          onPress={() => onPick(track)}
          style={[
            styles.tile,
            { backgroundColor: t.surface, borderColor: t.line },
          ]}
        >
          <TrackArt track={track} size={80} radius={6} />
          <View style={styles.meta}>
            <Text numberOfLines={1} style={[styles.title, { color: t.ink }]}>
              {cleanTitle(track.title)}
            </Text>
            <Text numberOfLines={1} style={[label(8.5), { color: t.inkFaint }]}>
              {[track.artist, track.language].filter(Boolean).join(' · ')}
            </Text>
            {!!track.album && (
              <Text
                numberOfLines={1}
                style={[styles.album, { color: t.inkSoft }]}
              >
                from {track.album}
              </Text>
            )}
          </View>
        </PressScale>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  rail: { gap: 12, paddingHorizontal: 22 },
  tile: {
    width: 260,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  meta: { flex: 1, gap: 3 },
  title: type.blockTitle,
  album: { fontFamily: fonts.regular, fontSize: 12 },
});
