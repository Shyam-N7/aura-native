import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { PressScale } from '../ui/PressScale';
import { TrackArt } from '../TrackRow';
import { fonts, label } from '../../theme/tokens';
import { cleanTitle } from '../../utils/title';

// Compact cover-tile rail for recommendation shelves ("more like {song}") —
// denser than MemoryRail's wide cards: a dozen picks scan in two swipes.
// Tap and long-press both hand back (track, index); the screen opens the
// track options sheet for either (new listeners expect choices on tap, not
// instant playback) and its "play song" queues the rail from that tile.
export function RelatedRail({ tracks, onPick, onLongPress }) {
  const { t } = useTheme();
  return (
    <ScrollView
      overScrollMode="always"
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
    >
      {tracks.map((track, i) => (
        <PressScale
          key={track.id}
          accessibilityRole="button"
          accessibilityLabel={`options for ${cleanTitle(track.title)}`}
          onPress={() => onPick(track, i)}
          onLongPress={onLongPress ? () => onLongPress(track, i) : undefined}
          style={styles.tile}
        >
          <TrackArt track={track} size={104} radius={8} />
          <View style={styles.meta}>
            <Text numberOfLines={1} style={[styles.title, { color: t.ink }]}>
              {cleanTitle(track.title)}
            </Text>
            <Text
              numberOfLines={1}
              style={[label(8.5), { color: t.inkFaint }]}
            >
              {track.artist ?? ''}
            </Text>
          </View>
        </PressScale>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  rail: { gap: 12, paddingHorizontal: 22 },
  tile: { width: 104, gap: 6 },
  meta: { gap: 2 },
  title: { fontFamily: fonts.medium, fontSize: 12.5 },
});
