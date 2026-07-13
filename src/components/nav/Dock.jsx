import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../Icon';
import { MiniBar } from '../player/MiniBar';
import { useTheme } from '../../theme/ThemeContext';

const TAB_ICONS = {
  Home: 'home',
  Search: 'search',
  Talk: 'chat',
  You: 'user',
};

// Pill dock tab bar, with the MiniBar riding directly above the pill while a
// track is loaded (MiniBar renders null otherwise).
export function Dock({ state, descriptors, navigation }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.wrap,
        { paddingBottom: insets.bottom + 10, backgroundColor: t.bg },
      ]}
    >
      <MiniBar />
      <View
        style={[styles.pill, { backgroundColor: t.surface, borderColor: t.line }]}
      >
        {state.routes.map((route, i) => {
          const focused = state.index === i;
          const { options } = descriptors[route.key];
          const label = options.tabBarLabel ?? route.name.toLowerCase();
          const tint = focused ? t.accent : t.inkFaint;
          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };
          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={label}
              onPress={onPress}
              style={styles.tab}
            >
              <Icon name={TAB_ICONS[route.name]} size={22} color={tint} />
              <Text style={[styles.label, { color: tint }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  pill: {
    flexDirection: 'row',
    borderRadius: 28,
    borderWidth: 1,
    paddingVertical: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  label: {
    fontSize: 11,
  },
});
