import React from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';

// Phase 0 — toolchain proof. Replaced by the real app in Phase 1.
export default function App() {
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0b0b10" />
      <Text style={styles.brand}>AURA</Text>
      <Text style={styles.note}>native build works — phase 0</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0b0b10',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  brand: {
    color: '#f2f0ff',
    fontSize: 40,
    fontWeight: '700',
    letterSpacing: 10,
  },
  note: {
    color: '#8f8ca6',
    fontSize: 14,
  },
});
