import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Sheet } from '../components/ui/Sheet';
import { SHEET_DANGER } from '../components/ui/SheetRow';
import { subscribeConfirm, resolveConfirm } from '../lib/confirm';
import { fonts } from '../theme/tokens';

// The house confirm — a bottom sheet in the app's own language instead of the
// OS's gray Alert box. One instance lives in App; lib/confirm.js routes every
// confirm() here. Cancel is a quiet text button, the action is a filled pill
// (danger red for destructive asks, accent otherwise); backdrop, back button
// and drag-down all read as cancel.
export function ConfirmSheet() {
  const { t } = useTheme();
  const [req, setReq] = useState(null);
  useEffect(() => subscribeConfirm(setReq), []);

  if (!req) {
    return null;
  }
  const actionColor = req.danger ? SHEET_DANGER : t.accent;
  return (
    <Sheet
      animated={!req.instant}
      onClose={() => resolveConfirm(false)}
      closeLabel="cancel"
    >
      <Text style={[styles.title, { color: t.ink }]}>{req.title}</Text>
      {!!req.body && (
        <Text style={[styles.body, { color: t.inkSoft }]}>{req.body}</Text>
      )}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="cancel"
          onPress={() => resolveConfirm(false)}
          hitSlop={8}
          style={({ pressed }) => [styles.cancel, { borderColor: t.line }, pressed && styles.pressed]}
        >
          <Text style={[styles.cancelText, { color: t.inkSoft }]}>cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={req.action}
          onPress={() => resolveConfirm(true)}
          style={({ pressed }) => [
            styles.action,
            { backgroundColor: actionColor },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.actionText, { color: t.bg }]}>{req.action}</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: fonts.semibold,
    fontSize: 18,
    marginTop: 2,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 13.5,
    lineHeight: 19,
    marginTop: 6,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 18,
    marginTop: 18,
    marginBottom: 2,
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
