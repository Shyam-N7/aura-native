import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { subscribeToast } from '../lib/toast';
import { useTheme } from '../theme/ThemeContext';

// Renders the most recent toast; auto-clears ~2s after it lands. New events
// replace the current toast (last-write-wins). Ported from web Toast.jsx.
export function Toast() {
  const { t } = useTheme();
  const [current, setCurrent] = useState(null);

  useEffect(() => subscribeToast(setCurrent), []);

  useEffect(() => {
    if (!current) {
      return;
    }
    const id = setTimeout(
      () => setCurrent(c => (c?.id === current.id ? null : c)),
      2000,
    );
    return () => clearTimeout(id);
  }, [current]);

  if (!current) {
    return null;
  }
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View key={current.id} style={[styles.pill, { backgroundColor: t.ink }]}>
        <Text style={[styles.text, { color: t.bg }]}>{current.message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    // Clears the dock (and a future mini bar) at the bottom of the shell.
    bottom: 120,
    alignItems: 'center',
  },
  pill: {
    maxWidth: '82%',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
  },
  text: {
    fontSize: 14,
  },
});
