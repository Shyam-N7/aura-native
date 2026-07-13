import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { getFeatured } from '../api/catalog';
import { getUser } from '../lib/auth';
import { showToast } from '../lib/toast';

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

export default function HomeScreen() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
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
    <View
      style={[
        styles.root,
        { backgroundColor: t.bg, paddingTop: insets.top + 24 },
      ]}>
      <Text style={[styles.brand, { color: t.inkFaint }]}>aura</Text>
      <Text style={[styles.greeting, { color: t.ink }]}>
        {greeting()}
        {firstName ? `, ${firstName}` : ''}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="play something"
        onPress={playSomething}
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: t.accentSoft, borderColor: t.line },
          pressed && styles.pressed,
        ]}>
        <Text style={[styles.cardTitle, { color: t.accent }]}>
          play something
        </Text>
        <Text style={[styles.cardSub, { color: t.inkSoft }]}>
          {loading ? 'finding songs…' : "starts tonight's set"}
        </Text>
      </Pressable>

      <Text style={[styles.note, { color: t.inkFaint }]}>
        your mixes, library and more arrive in the next build.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 20,
  },
  brand: {
    fontSize: 12,
    letterSpacing: 1,
  },
  greeting: {
    fontSize: 26,
    fontWeight: '600',
    marginTop: 6,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 20,
    marginTop: 28,
    gap: 4,
  },
  pressed: {
    opacity: 0.7,
  },
  cardTitle: {
    fontSize: 19,
    fontWeight: '600',
  },
  cardSub: {
    fontSize: 13,
  },
  note: {
    fontSize: 12.5,
    marginTop: 18,
  },
});
