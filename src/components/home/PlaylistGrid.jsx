import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { PressScale } from '../ui/PressScale';
import { fonts, label } from '../../theme/tokens';

// Shared 2-col cover grid for "made by you" / "made for you" / "popular
// playlists". Items are pre-normalized: { id, name, cover, meta }.
export function PlaylistGrid({ items, onPressItem }) {
  const { t } = useTheme();
  return (
    <View style={styles.grid}>
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
    gap: 14,
    paddingHorizontal: 22,
  },
  cell: { flexBasis: '47%', flexGrow: 1, gap: 5 },
  cover: { width: '100%', aspectRatio: 1, borderRadius: 8 },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  letter: { fontFamily: fonts.semibold, fontSize: 40 },
  name: { fontFamily: fonts.medium, fontSize: 15 },
});
