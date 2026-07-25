import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { EqualizerPanel } from '../components/audio/EqualizerPanel';
import { PressScale } from '../components/ui/PressScale';
import { Icon } from '../components/Icon';
import { useTheme } from '../theme/ThemeContext';
import { fonts, label } from '../theme/tokens';

// The equalizer over the music. Opened from the player's ⋯ menu, it floats on
// top of the player instead of navigating anywhere — tweaking the sound while
// a song plays should never mean leaving the song. (The settings entry still
// opens the full screen; both render the same EqualizerPanel.)
//
// A Modal, so it clears the player's elevation; capped at 88% height with the
// controls scrolling inside, since the fader stack plus presets is taller than
// a small phone.
export function EqualizerPopup({ visible, onClose }) {
  const { t } = useTheme();
  return (
    <Modal
      transparent
      statusBarTranslucent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="close">
        {/* Swallow taps inside the card so only the scrim dismisses. */}
        <Pressable
          style={[styles.card, { backgroundColor: t.surface, borderColor: t.line }]}
          onPress={() => {}}
        >
          <View style={styles.head}>
            <View style={styles.headMeta}>
              <Text style={[label(9.5), { color: t.inkFaint }]}>audio</Text>
              <Text style={[styles.title, { color: t.ink }]}>equalizer</Text>
            </View>
            <PressScale
              accessibilityRole="button"
              accessibilityLabel="close"
              onPress={onClose}
              hitSlop={10}
            >
              <Icon name="close" size={20} color={t.inkSoft} />
            </PressScale>
          </View>
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <EqualizerPanel />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(10, 8, 6, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 40,
  },
  card: {
    alignSelf: 'stretch',
    maxWidth: 460,
    maxHeight: '88%',
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 8,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start' },
  headMeta: { flex: 1, gap: 2 },
  title: {
    fontFamily: fonts.regular,
    fontSize: 26,
    lineHeight: 28,
    letterSpacing: -0.7,
  },
  body: { marginTop: 4 },
  bodyContent: { paddingBottom: 14 },
});
