import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { Icon } from '../Icon';
import { SHEET_DANGER } from './SheetRow';
import { fonts } from '../../theme/tokens';

// The house confirm as a centered POPUP — user-specified for the
// background-play switch: "popup, not sheet". Same voice as ConfirmSheet
// (quiet text cancel, filled accent pill action) in a card floated over a
// scrim, plus an optional "don't ask again" checkbox. Plain RN Modal fade —
// no reanimated entering/exiting (the documented 4.2.3/Fabric abort class).
export function ConfirmPopup({
  visible,
  title,
  body,
  action,
  // Red action pill for a destructive ask, same token and same rule as
  // ConfirmSheet. This prop did not exist, so the equalizer's DELETE PRESET
  // confirm wore the ordinary accent — identical to "turn on" and "boost it"
  // beside it — and the one visual cue the app uses to mark a destructive
  // action was missing from a destructive action.
  danger = false,
  onConfirm,
  onCancel,
  dontAsk,
  onToggleDontAsk,
}) {
  const { t } = useTheme();
  const actionColor = danger ? SHEET_DANGER : t.accent;
  return (
    <Modal
      transparent
      statusBarTranslucent
      visible={visible}
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable
        style={styles.scrim}
        onPress={onCancel}
        accessibilityLabel="dismiss"
      >
        <Pressable
          style={[
            styles.card,
            { backgroundColor: t.surface, borderColor: t.line },
          ]}
          // Swallow taps on the card so only the scrim cancels.
          onPress={() => {}}
        >
          <Text style={[styles.title, { color: t.ink }]}>{title}</Text>
          {!!body && (
            <Text style={[styles.body, { color: t.inkSoft }]}>{body}</Text>
          )}
          {!!onToggleDontAsk && (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !!dontAsk }}
              accessibilityLabel="don't ask again"
              onPress={onToggleDontAsk}
              hitSlop={8}
              style={styles.checkRow}
            >
              <View
                style={[
                  styles.checkbox,
                  { borderColor: dontAsk ? t.accent : t.line },
                  dontAsk && { backgroundColor: t.accent },
                ]}
              >
                {dontAsk && (
                  <Icon name="check" size={11} color={t.bg} strokeWidth={2.6} />
                )}
              </View>
              <Text style={[styles.checkLabel, { color: t.inkSoft }]}>
                don't ask again
              </Text>
            </Pressable>
          )}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="cancel"
              onPress={onCancel}
              hitSlop={8}
              style={({ pressed }) => [styles.cancel, { borderColor: t.line }, pressed && styles.pressed]}
            >
              <Text style={[styles.cancelText, { color: t.inkSoft }]}>
                cancel
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={action}
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.action,
                { backgroundColor: actionColor },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.actionText, { color: t.bg }]}>{action}</Text>
            </Pressable>
          </View>
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
    padding: 32,
  },
  card: {
    alignSelf: 'stretch',
    maxWidth: 400,
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
  },
  title: {
    fontFamily: fonts.semibold,
    fontSize: 18,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 13.5,
    lineHeight: 19,
    marginTop: 6,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 14,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkLabel: {
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 18,
    marginTop: 18,
  },
  cancel: {
    // An outlined pill matching the action's geometry — field feedback was
    // that a bare text cancel beside a filled pill read as fine print, not as
    // an equal choice. Border only, so the filled action still leads.
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  cancelText: {
    fontFamily: fonts.medium,
    fontSize: 14.5,
  },
  action: {
    borderRadius: 999,
    paddingVertical: 11,
    paddingHorizontal: 22,
  },
  actionText: {
    fontFamily: fonts.medium,
    fontSize: 14.5,
  },
  pressed: {
    opacity: 0.7,
  },
});
