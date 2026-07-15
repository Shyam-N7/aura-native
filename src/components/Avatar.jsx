import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { fonts } from '../theme/tokens';

// Shared identity avatar, ported from web Avatar.jsx — a profile photo when
// the user has one, else the initial-letter monogram (the app's long-standing
// fallback). `user` is any object with { name, avatarUrl }.
export function Avatar({ user, size = 28 }) {
  const { t } = useTheme();
  const [failed, setFailed] = useState(false);
  const initial = ((user?.name ?? '').trim()[0] ?? '·').toLowerCase();
  const shape = { width: size, height: size, borderRadius: size / 2 };
  if (user?.avatarUrl && !failed) {
    return (
      <Image
        source={{ uri: user.avatarUrl }}
        onError={() => setFailed(true)}
        style={shape}
      />
    );
  }
  return (
    <View style={[styles.fallback, shape, { backgroundColor: t.accentSoft }]}>
      <Text
        style={[
          styles.initial,
          { color: t.accent, fontSize: Math.round(size * 0.46) },
        ]}
      >
        {initial}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initial: { fontFamily: fonts.semibold },
});
