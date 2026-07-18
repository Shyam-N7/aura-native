import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import {
  closeWhatsNew,
  openWhatsNew,
  shouldShowWhatsNew,
  subscribeWhatsNew,
} from '../lib/whatsNew';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/ui/Sheet';
import { fonts, label } from '../theme/tokens';

// The guide to what just shipped. Static rows — each one names the feature
// and where to find it, in plain words. Auto-opens once per batch (the mount
// effect below), and you → settings can reopen it anytime.
const FEATURES = [
  {
    icon: 'heart',
    title: 'double-tap to like',
    line: 'tap the cover twice on the player.',
  },
  {
    icon: 'next',
    title: 'swipe to change song',
    line: 'flick the cover left for next, right to go back.',
  },
  {
    icon: 'lyrics',
    title: 'karaoke',
    line: 'open lyrics and tap karaoke to sing along.',
  },
  {
    icon: 'quality',
    title: 'auto quality',
    line: 'picks the right stream for your signal — in the quality picker.',
  },
  {
    icon: 'cog',
    title: 'volume leveling',
    line: 'keeps songs at an even loudness — in you, under settings.',
  },
];

// Let the home screen land before the guide slides up on a fresh update.
const AUTO_OPEN_DELAY_MS = 1500;

export function WhatsNewSheet() {
  const { t } = useTheme();
  const [open, setOpen] = useState(false);

  useEffect(() => subscribeWhatsNew(setOpen), []);

  // Auto-open once per batch. This component only mounts inside the main
  // flow, so the auth / sensing / onboarding gates have already passed.
  useEffect(() => {
    if (!shouldShowWhatsNew()) {
      return undefined;
    }
    const id = setTimeout(openWhatsNew, AUTO_OPEN_DELAY_MS);
    return () => clearTimeout(id);
  }, []);

  if (!open) {
    return null;
  }

  return (
    <Sheet onClose={closeWhatsNew} closeLabel="close what's new">
      <Text style={[styles.title, { color: t.ink }]}>what's new</Text>
      <Text style={[label(9.5), styles.sub, { color: t.inkFaint }]}>
        fresh in this update
      </Text>
      {FEATURES.map(f => (
        <View key={f.title} style={styles.row}>
          <View style={[styles.disc, { backgroundColor: t.accentSoft }]}>
            <Icon name={f.icon} size={17} color={t.accent} />
          </View>
          <View style={styles.rowMeta}>
            <Text style={[styles.rowTitle, { color: t.ink }]}>{f.title}</Text>
            <Text style={[styles.rowLine, { color: t.inkSoft }]}>
              {f.line}
            </Text>
          </View>
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="got it"
        onPress={closeWhatsNew}
        style={({ pressed }) => [
          styles.gotIt,
          { backgroundColor: t.accent },
          pressed && styles.pressed,
        ]}
      >
        <Text style={[styles.gotItText, { color: t.bg }]}>got it</Text>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.semibold, fontSize: 18 },
  sub: { marginTop: 3, marginBottom: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 9,
  },
  disc: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowMeta: { flex: 1, minWidth: 0, gap: 1 },
  rowTitle: { fontFamily: fonts.medium, fontSize: 15 },
  rowLine: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 17 },
  gotIt: {
    alignSelf: 'stretch',
    alignItems: 'center',
    borderRadius: 999,
    paddingVertical: 12,
    marginTop: 12,
  },
  gotItText: { fontFamily: fonts.semibold, fontSize: 14.5 },
  pressed: { opacity: 0.8 },
});
