import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../Icon';
import { useTheme } from '../../theme/ThemeContext';
import { fonts } from '../../theme/tokens';

// One menu row inside a bottom sheet: leading icon + label, optional danger
// red. Shared by the track-actions and queue-options sheets so every sheet
// menu reads identically. Reads on every theme; there is no danger token.
export const SHEET_DANGER = '#b3402e';

export function SheetRow({ icon, label, danger = false, onPress }) {
  const { t } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.item, pressed && styles.pressed]}
    >
      {icon ? (
        <Icon name={icon} size={19} color={danger ? SHEET_DANGER : t.inkSoft} />
      ) : (
        <View style={styles.iconGap} />
      )}
      <Text
        style={[styles.itemLabel, { color: danger ? SHEET_DANGER : t.ink }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
  },
  pressed: { opacity: 0.6 },
  iconGap: { width: 19 },
  itemLabel: { fontFamily: fonts.medium, fontSize: 15 },
});
