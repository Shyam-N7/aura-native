import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { getUser, logout } from '../lib/auth';
import { QUALITIES } from '../lib/audioQuality';
import { TopBar } from '../components/nav/TopBar';

export default function YouScreen({ navigation }) {
  const { t } = useTheme();
  const player = usePlayer();
  const user = getUser();

  const confirmSignOut = () => {
    Alert.alert('sign out?', 'you can sign back in anytime.', [
      { text: 'cancel', style: 'cancel' },
      { text: 'sign out', style: 'destructive', onPress: () => logout() },
    ]);
  };

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <TopBar navigation={navigation} />
      <View style={styles.content}>
      <View style={styles.identity}>
        <View style={[styles.avatar, { backgroundColor: t.accentSoft }]}>
          <Text style={[styles.avatarLetter, { color: t.accent }]}>
            {(user?.name ?? '·').trim()[0]?.toLowerCase() ?? '·'}
          </Text>
        </View>
        <View style={styles.who}>
          <Text numberOfLines={1} style={[styles.name, { color: t.ink }]}>
            {user?.name ?? ''}
          </Text>
          <Text numberOfLines={1} style={[styles.email, { color: t.inkSoft }]}>
            {user?.email ?? ''}
          </Text>
        </View>
      </View>

      <Text style={[styles.section, { color: t.inkFaint }]}>audio quality</Text>
      <View
        style={[
          styles.qualityCard,
          { backgroundColor: t.surface, borderColor: t.line },
        ]}>
        {QUALITIES.map(q => {
          const on = player.quality === q.id;
          return (
            <Pressable
              key={q.id}
              accessibilityRole="button"
              accessibilityLabel={`quality ${q.label}`}
              accessibilityState={on ? { selected: true } : {}}
              onPress={() => player.setQuality(q.id)}
              style={({ pressed }) => [
                styles.qualityRow,
                pressed && styles.pressed,
              ]}>
              <View style={styles.qualityMeta}>
                <Text
                  style={[
                    styles.qualityLabel,
                    { color: on ? t.accent : t.ink },
                  ]}>
                  {q.label}
                </Text>
                <Text style={[styles.qualityCaption, { color: t.inkSoft }]}>
                  {q.caption}
                </Text>
              </View>
              <View
                style={[
                  styles.dot,
                  { borderColor: on ? t.accent : t.line },
                  on && { backgroundColor: t.accent },
                ]}
              />
            </Pressable>
          );
        })}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="sign out"
        onPress={confirmSignOut}
        style={({ pressed }) => [
          styles.signOut,
          { borderColor: t.line },
          pressed && styles.pressed,
        ]}>
        <Text style={[styles.signOutText, { color: t.accent }]}>sign out</Text>
      </Pressable>

      <Text style={[styles.version, { color: t.inkFaint }]}>
        aura · phase 1
      </Text>
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
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    fontSize: 24,
    fontWeight: '600',
  },
  who: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 18,
    fontWeight: '600',
  },
  email: {
    fontSize: 13,
  },
  section: {
    fontSize: 11,
    letterSpacing: 0.4,
    marginTop: 28,
    marginBottom: 8,
  },
  qualityCard: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
  },
  qualityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  pressed: {
    opacity: 0.6,
  },
  qualityMeta: {
    flex: 1,
    gap: 1,
  },
  qualityLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  qualityCaption: {
    fontSize: 12,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
  },
  signOut: {
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 28,
  },
  signOutText: {
    fontSize: 14.5,
    fontWeight: '500',
  },
  version: {
    fontSize: 12,
    marginTop: 16,
    textAlign: 'center',
  },
});
