import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenFade } from '../components/ui/ScreenFade';
import { PressScale } from '../components/ui/PressScale';
import { EqualizerPanel } from '../components/audio/EqualizerPanel';
import { Icon } from '../components/Icon';
import { DOCK_CLEARANCE } from '../components/nav/Dock';
import { useTheme } from '../theme/ThemeContext';
import { fonts, label } from '../theme/tokens';

// The equalizer as a screen — reached from you → settings, where there's room
// to sit and dial it in. The controls themselves live in EqualizerPanel, which
// the player also opens as a popup so a mid-song tweak never leaves the music.

export default function EqualizerScreen({ navigation }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <ScreenFade>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <PressScale
            accessibilityRole="button"
            accessibilityLabel="back"
            onPress={() => navigation.goBack()}
            hitSlop={10}
            style={styles.back}
          >
            <Icon name="chevron-left" size={22} color={t.ink} />
          </PressScale>
          <Text style={[label(10), { color: t.inkFaint }]}>Audio · equalizer</Text>
          <Text style={[styles.hero, { color: t.ink }]}>Equalizer</Text>
          <EqualizerPanel />
        </ScrollView>
      </ScreenFade>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 22, paddingBottom: 24 + DOCK_CLEARANCE },
  back: {
    width: 38,
    height: 38,
    justifyContent: 'center',
    marginLeft: -8,
    marginBottom: 6,
  },
  hero: {
    fontFamily: fonts.regular,
    fontSize: 34,
    lineHeight: 36,
    letterSpacing: -1.02,
    marginTop: 4,
    marginBottom: 6,
  },
});
