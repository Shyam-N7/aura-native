import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { Icon } from '../Icon';
import { fonts, label } from '../../theme/tokens';

// Find-in-list field + sort chips for track collections (liked songs,
// playlist details). The screen owns the query/sort state — this is just the
// control row, styled after the search tab's language pills.
export function ListTools({ query, onQuery, sort, onSort, sorts }) {
  const { t } = useTheme();
  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.field,
          { borderColor: t.line, backgroundColor: t.surface },
        ]}
      >
        <Icon name="search" size={15} color={t.inkFaint} />
        <TextInput
          value={query}
          onChangeText={onQuery}
          placeholder="find in songs"
          placeholderTextColor={t.inkFaint}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="find in songs"
          style={[styles.input, { color: t.ink }]}
        />
        {query.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="clear search"
            onPress={() => onQuery('')}
            hitSlop={10}
          >
            <Icon name="close" size={14} color={t.inkFaint} />
          </Pressable>
        )}
      </View>
      <View style={styles.chips}>
        {sorts.map(s => {
          const on = sort === s.id;
          return (
            <Pressable
              key={s.id}
              accessibilityRole="button"
              accessibilityLabel={`sort by ${s.label}`}
              accessibilityState={on ? { selected: true } : {}}
              onPress={() => onSort(s.id)}
              style={({ pressed }) => [
                styles.chip,
                { borderColor: on ? t.accent : t.line },
                on && { backgroundColor: t.accentSoft },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[label(9), { color: on ? t.accent : t.inkSoft }]}>
                {s.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 9, marginTop: 12 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    paddingVertical: 8,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  pressed: { opacity: 0.7 },
});
