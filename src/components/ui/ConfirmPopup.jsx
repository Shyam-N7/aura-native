import React from 'react';
import { Modal, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { ConfirmCard } from './ConfirmCard';

// The house confirm as a centered POPUP — user-specified for the
// background-play switch: "popup, not sheet". The card is ConfirmCard, the
// same one ConfirmSheet renders; this file owns only the container — a card
// floated over a scrim, on a plain RN Modal fade (no reanimated
// entering/exiting: the documented 4.2.3/Fabric abort class).
export function ConfirmPopup({
  visible,
  title,
  body,
  action,
  // Red action pill for a destructive ask. Opt-in, the same way round as
  // ConfirmSheet and lib/confirm — red is the one cue this app uses to mark a
  // destructive action, so it must be asked for.
  danger = false,
  onConfirm,
  onCancel,
  dontAsk,
  onToggleDontAsk,
}) {
  const { t } = useTheme();
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
          <ConfirmCard
            title={title}
            body={body}
            action={action}
            danger={danger}
            onConfirm={onConfirm}
            onCancel={onCancel}
            dontAsk={dontAsk}
            onToggleDontAsk={onToggleDontAsk}
          />
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
});
