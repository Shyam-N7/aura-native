import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
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
// The panel doesn't scroll, so the card just hugs its content. Two rules keep
// the faders draggable in here:
//  - GestureHandlerRootView: a Modal is its own native window, OUTSIDE the
//    root view gesture-handler attaches to — without a fresh root inside, the
//    fader pans simply never fire (same as Sheet.jsx).
//  - the scrim is a SIBLING behind the card, never a Pressable wrapping it,
//    so nothing claims a drag before the fader does.
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
      <GestureHandlerRootView style={styles.root}>
        <View style={styles.wrap}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityLabel="close"
          />
          <View
            style={[styles.card, { backgroundColor: t.surface, borderColor: t.line }]}
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
            <EqualizerPanel />
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  wrap: {
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
    maxHeight: '100%',
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start' },
  headMeta: { flex: 1, gap: 2 },
  title: {
    fontFamily: fonts.regular,
    fontSize: 26,
    lineHeight: 28,
    letterSpacing: -0.7,
  },
});
