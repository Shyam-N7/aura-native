import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { Icon } from '../Icon';
import { SHEET_DANGER } from './SheetRow';
import { fonts, radii, space } from '../../theme/tokens';

// The house confirm's CARD — title, body, the optional "don't ask again"
// checkbox, and the Cancel/action pair. Only the container differs between the
// two confirms the app ships (ConfirmSheet's bottom sheet and ConfirmPopup's
// centered modal), so the card itself lives here once: the two had drifted
// into byte-identical copies, and one of them silently grew a different
// `danger` default. Cancel is an outlined pill matching the action's geometry,
// the action is filled — danger red for a destructive ask, accent otherwise.
//
// `danger` defaults to FALSE here and in both containers and in
// lib/confirm.js: red is the app's one cue for "this destroys something", so a
// caller must opt into it rather than opt out.
export function ConfirmCard({
  title,
  body,
  action,
  danger = false,
  onConfirm,
  onCancel,
  // The checkbox only renders when a container hands it a toggle — the sheet
  // never does, the popup does for the background-play ask.
  dontAsk,
  onToggleDontAsk,
  style,
}) {
  const { t } = useTheme();
  const actionColor = danger ? SHEET_DANGER : t.accent;
  return (
    <View style={style}>
      <Text style={[styles.title, { color: t.ink }]}>{title}</Text>
      {!!body && <Text style={[styles.body, { color: t.inkSoft }]}>{body}</Text>}
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
            Don't ask again
          </Text>
        </Pressable>
      )}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="cancel"
          onPress={onCancel}
          hitSlop={8}
          style={({ pressed }) => [
            styles.cancel,
            { borderColor: t.line },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.cancelText, { color: t.inkSoft }]}>Cancel</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: fonts.semibold,
    fontSize: 18,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 13.5,
    lineHeight: 19,
    marginTop: space.s6,
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
    borderRadius: radii.pill,
    paddingVertical: 10,
    paddingHorizontal: space.s20,
  },
  cancelText: {
    fontFamily: fonts.medium,
    fontSize: 14.5,
  },
  action: {
    borderRadius: radii.pill,
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
