import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenFade } from '../components/ui/ScreenFade';
import { PageHeader } from '../components/detail/DetailChassis';
import { EqualizerPanel } from '../components/audio/EqualizerPanel';
import { DOCK_CLEARANCE } from '../components/nav/Dock';
import { useTheme } from '../theme/ThemeContext';

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
          <PageHeader
            eyebrow="Audio · equalizer"
            title="Equalizer"
            titleStyle={styles.title}
            onBack={() => navigation.goBack()}
          />
          <EqualizerPanel />
        </ScrollView>
      </ScreenFade>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 22, paddingBottom: 24 + DOCK_CLEARANCE },
  title: { marginTop: 4, marginBottom: 6 },
});
