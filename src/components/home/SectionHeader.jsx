import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { type, label } from '../../theme/tokens';

// Shared home section header, ported from web SectionHeader.jsx: title, small
// sub line, optional "see all" affordance on the right.
export function SectionHeader({ title, sub, seeAllLabel, onSeeAll }) {
  const { t } = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.titles}>
        <Text style={[type.sectionTitle, { color: t.ink }]}>{title}</Text>
        {!!sub && (
          <Text style={[label(9.5), { color: t.inkFaint }]} numberOfLines={1}>
            {sub}
          </Text>
        )}
      </View>
      {!!onSeeAll && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={seeAllLabel ?? `see all ${title}`}
          onPress={onSeeAll}
          hitSlop={10}
          style={styles.seeAll}
        >
          <Text style={[label(9.5), { color: t.accent }]}>See all →</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    marginBottom: 12,
  },
  titles: { gap: 3, flexShrink: 1 },
  // ~11dp of label text is nowhere near tappable. Padding grows the touch box
  // and the equal negative margin returns the space to the row, so the header
  // keeps its height and "See all" stays pinned to the same right edge:
  // 11 + 20 padding + 20 hitSlop = 51dp.
  seeAll: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginVertical: -10,
    marginHorizontal: -12,
  },
});
