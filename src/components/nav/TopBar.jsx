import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Glass } from '../ui/Glass';
import { PressScale } from '../ui/PressScale';
import { Icon } from '../Icon';
import { useTheme } from '../../theme/ThemeContext';
import { getUser } from '../../lib/auth';
import { themes, type, radii } from '../../theme/tokens';

const THEME_ORDER = Object.keys(themes);
// The cycle button wears the active theme's own glyph.
const THEME_ICON = { dusk: 'sun', midnight: 'moon', bloom: 'bloom' };

// The web's glass top bar: wordmark left, controls right. Mode chip and profile
// actions arrive with Phase 2 — the profile circle is decorative for now.
// `navigation` comes from the hosting screen's props (screens render standalone
// in tests, so no useNavigation here).
export function TopBar({ navigation }) {
  const { name, t, setTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const initial = (getUser()?.name || 'a').trim()[0]?.toLowerCase();

  const cycleTheme = () => {
    const next =
      THEME_ORDER[(THEME_ORDER.indexOf(name) + 1) % THEME_ORDER.length];
    setTheme(next);
  };

  return (
    <View style={[styles.wrap, { marginTop: insets.top + 10 }]}>
      <Glass radius={radii.pill} style={styles.bar}>
        <View style={styles.row}>
          <Text style={[type.wordmark, { color: t.ink }]}>aura</Text>
          <View style={styles.spacer} />
          <PressScale
            accessibilityRole="button"
            accessibilityLabel="switch theme"
            onPress={cycleTheme}
            style={[styles.chip, { borderColor: t.line }]}
          >
            <Icon name={THEME_ICON[name]} size={16} color={t.inkSoft} />
          </PressScale>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel="open search"
            onPress={() => navigation?.navigate('Search')}
            style={[styles.chip, { borderColor: t.line }]}
          >
            <Icon name="search" size={16} color={t.inkSoft} />
          </PressScale>
          <View style={[styles.profile, { backgroundColor: t.accentSoft }]}>
            <Text style={[styles.profileText, { color: t.accent }]}>
              {initial}
            </Text>
          </View>
        </View>
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 14, marginBottom: 6 },
  bar: { height: 52, justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
  },
  spacer: { flex: 1 },
  chip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profile: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileText: { fontFamily: 'HankenGrotesk-SemiBold', fontSize: 14 },
});
