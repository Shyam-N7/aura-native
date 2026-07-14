import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { PressScale } from '../ui/PressScale';
import { Skeleton } from './Skeleton';
import { fonts, label } from '../../theme/tokens';
import { artUrl } from '../../utils/artUrl';
import { cleanTitle } from '../../utils/title';

// "Stations" — 2-col image tiles from pool slice(5, 9); a tap starts the set
// at that track. Caption bar sits on a dark strip so it reads on any art.
export function StationsGrid({ stations, loading, onPick }) {
  if (loading) {
    return (
      <View style={styles.grid}>
        {[0, 1, 2, 3].map(i => (
          <Skeleton key={i} height={150} radius={14} style={styles.cell} />
        ))}
      </View>
    );
  }
  return (
    <View style={styles.grid}>
      {stations.map(track => {
        const img = artUrl(track, 500);
        return (
          <PressScale
            key={track.id}
            accessibilityRole="button"
            accessibilityLabel={`station ${cleanTitle(track.title)}`}
            onPress={() => onPick(track)}
            style={[styles.cell, styles.tile]}
          >
            {img && (
              <Image source={{ uri: img }} style={StyleSheet.absoluteFill} />
            )}
            <View style={styles.caption}>
              <Text style={[label(8), styles.light]}>station</Text>
              <Text numberOfLines={1} style={styles.name}>
                {cleanTitle(track.title)}
              </Text>
              {!!track.artist && (
                <Text
                  numberOfLines={1}
                  style={[styles.artistLine, styles.light]}
                >
                  {track.artist}
                </Text>
              )}
            </View>
          </PressScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 22,
  },
  cell: { flexBasis: '47%', flexGrow: 1 },
  tile: {
    minHeight: 150,
    borderRadius: 14,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  caption: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 1,
  },
  name: { fontFamily: fonts.semibold, fontSize: 16, color: '#fff' },
  artistLine: { fontFamily: fonts.regular, fontSize: 11 },
  light: { color: 'rgba(255,255,255,0.75)' },
});
