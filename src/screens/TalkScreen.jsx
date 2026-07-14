import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { TopBar } from '../components/nav/TopBar';

// Honest placeholder — talk ships in a later phase.
export default function TalkScreen({ navigation }) {
  const { t } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <TopBar navigation={navigation} />
      <View style={styles.content}>
      <Text style={[styles.heading, { color: t.ink }]}>talk</Text>
      <View
        style={[
          styles.card,
          { backgroundColor: t.surface, borderColor: t.line },
        ]}>
        <Text style={[styles.cardTitle, { color: t.ink }]}>
          coming in the next build
        </Text>
        <Text style={[styles.cardSub, { color: t.inkSoft }]}>
          you'll be able to ask for songs in plain words.
        </Text>
      </View>
      </View>
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
  },
  heading: {
    fontFamily: 'HankenGrotesk-SemiBold',
    fontSize: 26,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 20,
    marginTop: 24,
    gap: 4,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  cardSub: {
    fontSize: 13,
  },
});
