import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../Icon';
import { useTheme } from '../../theme/ThemeContext';
import { fonts, semantic, space, type } from '../../theme/tokens';

// One menu row inside a sheet or a menu popup: leading icon + label, with an
// optional second line, an `on` (currently-active) accent state, a `disabled`
// dimming and a `danger` red. Every sheet menu in the app renders through this
// — the track-actions and queue-options sheets, the playlists ⋯ popup and the
// playlist sharing sheet — so they read identically. Reads on every theme;
// the danger red is an app-wide semantic token (tokens.js), re-exported here
// under its original name so every existing import keeps working.
export const SHEET_DANGER = semantic.danger;

// One icon size for every menu row. 19 is the primitive's own, and the size
// the majority of rendered rows already used.
const ICON = 19;

export function SheetRow({
  icon,
  label,
  // A quiet sub-line under the label, for rows whose consequence needs a
  // sentence (the sharing sheet's "They can listen after signing in").
  note,
  danger = false,
  // The row describes the state the app is already in — accent, not ink.
  on = false,
  disabled = false,
  onPress,
}) {
  const { t } = useTheme();
  const tint = danger ? SHEET_DANGER : on ? t.accent : t.inkSoft;
  const labelColor = disabled
    ? t.inkFaint
    : danger
      ? SHEET_DANGER
      : on
        ? t.accent
        : t.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={disabled ? { disabled: true } : {}}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.item, pressed && styles.pressed]}
    >
      {icon ? (
        <Icon name={icon} size={ICON} color={tint} />
      ) : (
        <View style={styles.iconGap} />
      )}
      <View style={styles.meta}>
        <Text style={[styles.itemLabel, { color: labelColor }]}>{label}</Text>
        {!!note && (
          <Text style={[styles.itemNote, { color: t.inkSoft }]}>{note}</Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: space.s12,
  },
  pressed: { opacity: 0.6 },
  iconGap: { width: ICON },
  meta: { flex: 1, minWidth: 0, gap: space.s2 },
  itemLabel: type.rowTitle,
  itemNote: { fontFamily: fonts.regular, fontSize: 12 },
});
