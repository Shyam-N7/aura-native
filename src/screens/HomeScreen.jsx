import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { getFeatured } from '../api/catalog';
import { getUser } from '../lib/auth';
import { showToast } from '../lib/toast';
import { TopBar } from '../components/nav/TopBar';
import { DOCK_CLEARANCE } from '../components/nav/Dock';
import { PressScale } from '../components/ui/PressScale';
import { ScreenFade } from '../components/ui/ScreenFade';
import { elevation } from '../theme/tokens';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) {
    return 'good morning';
  }
  if (hour < 17) {
    return 'good afternoon';
  }
  return 'good evening';
}

export default function HomeScreen({ navigation }) {
  const { t } = useTheme();
  const player = usePlayer();
  const [loading, setLoading] = useState(false);
  const firstName = getUser()?.name?.split(' ')[0]?.toLowerCase();

  const playSomething = async () => {
    if (loading) {
      return;
    }
    setLoading(true);
    try {
      const tracks = await getFeatured({ limit: 20 });
      if (tracks?.length) {
        player.playQueue(tracks, 0, "tonight's set");
        player.ui?.openPlayer?.();
      } else {
        showToast('nothing to play right now');
      }
    } catch {
      showToast("couldn't load songs — try again");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <TopBar navigation={navigation} />
      <ScreenFade style={styles.content}>
      <Text style={[styles.greeting, { color: t.ink }]}>
        {greeting()}
        {firstName ? `, ${firstName}` : ''}
      </Text>

      <PressScale
        accessibilityRole="button"
        accessibilityLabel="play something"
        onPress={playSomething}
        style={[
          styles.card,
          { backgroundColor: t.accentSoft, borderColor: t.line },
          elevation.accentGlow(t.accent),
        ]}>
        <Text style={[styles.cardTitle, { color: t.accent }]}>
          play something
        </Text>
        <Text style={[styles.cardSub, { color: t.inkSoft }]}>
          {loading ? 'finding songs…' : "starts tonight's set"}
        </Text>
      </PressScale>

      <Text style={[styles.note, { color: t.inkFaint }]}>
        your mixes, library and more arrive in the next build.
      </Text>
      </ScreenFade>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: DOCK_CLEARANCE,
  },
  greeting: {
    fontFamily: 'HankenGrotesk-SemiBold',
    fontSize: 26,
    marginTop: 6,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 20,
    marginTop: 28,
    gap: 4,
  },
  cardTitle: {
    fontFamily: 'HankenGrotesk-SemiBold',
    fontSize: 19,
  },
  cardSub: {
    fontFamily: 'HankenGrotesk-Regular',
    fontSize: 13,
  },
  note: {
    fontFamily: 'HankenGrotesk-Regular',
    fontSize: 12.5,
    marginTop: 18,
  },
});
