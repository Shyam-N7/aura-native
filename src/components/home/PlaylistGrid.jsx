import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { PressScale } from '../ui/PressScale';
import { fonts, label } from '../../theme/tokens';

// Shared 2-col cover grid for home rails ("made by you", "popular playlists"),
// artist discographies and language-hub shelves. Items are pre-normalized:
// { id, name, cover, meta }. `style` overrides the container (detail screens
// pad the whole scroll, so they zero the grid's own page padding).
export function PlaylistGrid({ items, onPressItem, style }) {
  const { t } = useTheme();
  return (
    <View style={[styles.grid, style]}>
      {items.map(item => (
        <PressScale
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={item.name}
          onPress={() => onPressItem(item)}
          style={styles.cell}
        >
          {item.cover ? (
            <Image source={{ uri: item.cover }} style={styles.cover} />
          ) : (
            <View
              style={[
                styles.cover,
                styles.fallback,
                { backgroundColor: t.accentSoft },
              ]}
            >
              <Text style={[styles.letter, { color: t.accent }]}>
                {(item.name?.trim()[0] ?? '·').toLowerCase()}
              </Text>
            </View>
          )}
          <Text numberOfLines={1} style={[styles.name, { color: t.ink }]}>
            {item.name}
          </Text>
          {!!item.meta && (
            <Text numberOfLines={1} style={[label(8), { color: t.inkFaint }]}>
              {item.meta}
            </Text>
          )}
        </PressScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 14,
    justifyContent: 'space-between',
    paddingHorizontal: 22,
  },
  // Fixed half-width so an odd last tile keeps its column (never stretches).
  cell: { flexBasis: '48%', gap: 5 },
  cover: { width: '100%', aspectRatio: 1, borderRadius: 8 },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  letter: { fontFamily: fonts.semibold, fontSize: 40 },
  name: { fontFamily: fonts.medium, fontSize: 15 },
});
