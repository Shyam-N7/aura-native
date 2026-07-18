import React, { useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { Glass } from '../ui/Glass';
import { PressScale } from '../ui/PressScale';
import { Icon } from '../Icon';
import { useTheme } from '../../theme/ThemeContext';
import { getUser } from '../../lib/auth';
import { openModeSheet } from '../../lib/modeSheet';
import { themes, type, radii, label } from '../../theme/tokens';
import { EASE, SPRING } from '../../theme/motion';

// Resting halo opacity once the wordmark's bloom settles.
const AURA_REST = 0.34;

// 'auto' rides the end of the cycle: it follows the system light/dark
// setting (dusk by day, midnight by night).
const THEME_ORDER = [...Object.keys(themes), 'auto'];
// The cycle button wears the active theme's own glyph; on 'auto' it wears
// the resolved theme's glyph inside an accent ring — the ring is the tell.
const THEME_ICON = { dusk: 'sun', midnight: 'moon', bloom: 'cat' };

// The web's glass top bar: wordmark left, controls right.
// `navigation` comes from the hosting screen's props (screens render standalone
// in tests, so no useNavigation here).
export function TopBar({ navigation }) {
  const { name, pref, t, setTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const user = getUser();
  const initial = (user?.name || 'a').trim()[0]?.toLowerCase();
  const mode = user?.activeMode ?? 'everyday';
  const modeLabel = (
    (user?.modes ?? []).find(m => m.key === mode)?.label ?? mode
  ).toLowerCase();

  const cycleTheme = () => {
    const next =
      THEME_ORDER[(THEME_ORDER.indexOf(pref) + 1) % THEME_ORDER.length];
    setTheme(next);
  };

  // "aura arrives with its aura": an accent halo blooms behind the wordmark,
  // breathes twice, and settles to a resting glow. Finite sequence — nothing
  // ticks after it lands. Replays on tab focus via the raw listener pattern
  // (ScreenFade's — screens still render standalone under jest).
  const reduced = useReducedMotion();
  const aura = useSharedValue(0);
  const squish = useSharedValue(0);

  const bloom = useCallback(() => {
    cancelAnimation(aura);
    if (reduced) {
      aura.value = AURA_REST;
      return;
    }
    aura.value = withSequence(
      withTiming(0.6, { duration: 700, easing: EASE.enter }),
      withRepeat(
        withSequence(
          withTiming(0.3, { duration: 1400, easing: EASE.settle }),
          withTiming(0.6, { duration: 1400, easing: EASE.settle }),
        ),
        2,
      ),
      withTiming(AURA_REST, { duration: 900, easing: EASE.exit }),
    );
  }, [aura, reduced]);

  useEffect(() => {
    bloom();
    const unsub = navigation?.addListener?.('focus', bloom);
    return () => {
      cancelAnimation(aura);
      cancelAnimation(squish);
      unsub?.();
    };
  }, [navigation, bloom, aura, squish]);

  // Tapping the wordmark squashes it like jelly; the release springs it back
  // and squeezes out a fresh aura pulse. Purely tactile — hidden from
  // accessibility so screen readers don't announce a do-nothing button.
  const pressIn = () => {
    if (reduced) return;
    cancelAnimation(squish);
    squish.value = withTiming(1, { duration: 90, easing: EASE.exit });
  };
  const pressOut = () => {
    if (reduced) return;
    squish.value = withSpring(0, SPRING.snapback);
    bloom();
  };

  const auraStyle = useAnimatedStyle(() => ({
    opacity: aura.value,
    transform: [{ scale: 0.88 + aura.value * 0.28 }],
  }));
  const squishStyle = useAnimatedStyle(() => ({
    transform: [
      { scaleX: 1 + squish.value * 0.1 },
      { scaleY: 1 - squish.value * 0.16 },
    ],
  }));

  return (
    <View style={[styles.wrap, { marginTop: insets.top + 10 }]}>
      <Glass radius={radii.pill} style={styles.bar}>
        <View style={styles.row}>
          <Pressable
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            onPressIn={pressIn}
            onPressOut={pressOut}
            style={styles.brand}
          >
            <Animated.View
              pointerEvents="none"
              style={[styles.auraGlow, auraStyle]}
            >
              <Svg width="100%" height="100%">
                <Defs>
                  {/* Solid stopColor + numeric stopOpacity — rn-svg renders
                      rgba() stop strings opaque on Android. */}
                  <RadialGradient
                    id="wordmarkAura"
                    cx="50%"
                    cy="50%"
                    rx="50%"
                    ry="50%"
                  >
                    <Stop offset="0" stopColor={t.accent} stopOpacity={0.5} />
                    <Stop
                      offset="0.65"
                      stopColor={t.accent}
                      stopOpacity={0.16}
                    />
                    <Stop offset="1" stopColor={t.accent} stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                <Ellipse
                  cx="50%"
                  cy="50%"
                  rx="50%"
                  ry="50%"
                  fill="url(#wordmarkAura)"
                />
              </Svg>
            </Animated.View>
            <Animated.View style={squishStyle}>
              <Text style={[type.wordmark, { color: t.ink }]}>aura</Text>
            </Animated.View>
          </Pressable>
          <View style={styles.spacer} />
          <PressScale
            accessibilityRole="button"
            accessibilityLabel="listening mode"
            onPress={openModeSheet}
            style={[
              styles.modePill,
              { borderColor: mode === 'everyday' ? t.line : t.accent },
              mode !== 'everyday' && { backgroundColor: t.accentSoft },
            ]}
          >
            <Text
              style={[
                label(8.5),
                { color: mode === 'everyday' ? t.inkSoft : t.accent },
              ]}
            >
              {modeLabel}
            </Text>
          </PressScale>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel="switch theme"
            accessibilityState={pref === 'auto' ? { selected: true } : {}}
            onPress={cycleTheme}
            style={[
              styles.chip,
              { borderColor: pref === 'auto' ? t.accent : t.line },
            ]}
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
          <PressScale
            accessibilityRole="button"
            accessibilityLabel="open profile"
            onPress={() => navigation?.navigate('You')}
            style={[styles.profile, { backgroundColor: t.accentSoft }]}
          >
            <Text style={[styles.profileText, { color: t.accent }]}>
              {initial}
            </Text>
          </PressScale>
        </View>
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  // zIndex keeps the bar painting above the screen's scroller: the rubber-band
  // bounce translates the whole scroller, and without this a card could
  // composite over the translucent bar during an overscroll (field report).
  wrap: { paddingHorizontal: 14, marginBottom: 6, zIndex: 20 },
  bar: { height: 52, justifyContent: 'center' },
  brand: { justifyContent: 'center' },
  auraGlow: { position: 'absolute', left: -22, right: -22, top: -8, bottom: -8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
  },
  spacer: { flex: 1 },
  modePill: {
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
