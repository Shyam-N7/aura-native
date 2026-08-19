import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { Icon } from '../Icon';
import { fonts, label, space } from '../../theme/tokens';

// A short pick-list as a centered POPUP — the sibling of ConfirmPopup, for
// choosing one of a handful of options rather than confirming an action.
// Picking a row commits immediately and closes: with this few choices, an OK
// button would just be a second tap that can't change the outcome.
//
// options: [{ id, label, caption? }] — id may be null (a real "automatic"
// choice), so selection is compared by identity, not truthiness.
export function PickerPopup({ visible, title, options, selected, onSelect, onClose }) {
  const { t } = useTheme();
  return (
    <Modal
      transparent
      statusBarTranslucent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="dismiss">
        <Pressable
          style={[styles.card, { backgroundColor: t.surface, borderColor: t.line }]}
          onPress={() => {}}
        >
          {!!title && (
            <Text style={[label(9.5), styles.title, { color: t.inkFaint }]}>
              {title}
            </Text>
          )}
          {options.map(opt => {
            const on = opt.id === selected;
            return (
              <Pressable
                key={String(opt.id)}
                accessibilityRole="button"
                accessibilityLabel={opt.label}
                accessibilityState={on ? { selected: true } : {}}
                onPress={() => {
                  onSelect(opt.id);
                  onClose();
                }}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <View style={styles.meta}>
                  <Text
                    style={[styles.rowLabel, { color: on ? t.accent : t.ink }]}
                  >
                    {opt.label}
                  </Text>
                  {!!opt.caption && (
                    <Text style={[styles.caption, { color: t.inkSoft }]}>
                      {opt.caption}
                    </Text>
                  )}
                </View>
                {on && <Icon name="check" size={16} color={t.accent} strokeWidth={2.4} />}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(10, 8, 6, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.s32,
  },
  card: {
    alignSelf: 'stretch',
    maxWidth: 400,
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  title: { marginBottom: space.s4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.s12,
    gap: space.s12,
  },
  meta: { flex: 1, gap: space.s2 },
  rowLabel: { fontFamily: fonts.medium, fontSize: 15.5 },
  caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  pressed: { opacity: 0.7 },
});
