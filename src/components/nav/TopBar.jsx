import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
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
import { closeSearch, openSearch, useSearchQuery } from '../../lib/searchQuery';
import { themes, type, radii, label, fonts } from '../../theme/tokens';
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
// `float` pins the bar over the screen's scroller (web: position fixed) so
// content slides beneath the glass — the host pads its content by
// TOPBAR_CLEARANCE + insets.top instead of stacking below the bar.
export const TOPBAR_CLEARANCE = 68; // 10 above + 52 bar + 6 below

export const TopBar = forwardRef(function TopBar(
  { navigation, float = false, onSubmitSearch },
  ref,
) {
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

  // Liquid search morph (web MobileTopBar port): the pill never resizes — two
  // absolutely-stacked layers cross-fade + scale in place. `open` rides the
  // shared bus (module-scope, not context) so whichever tab the chip is
  // tapped from and the Search tab's own TopBar instance agree on one state;
  // the query itself rides the same bus so SearchScreen reads what's typed
  // here.
  const { query, open: searching, instant, setQuery } = useSearchQuery();
  const searchInputRef = useRef(null);
  useImperativeHandle(ref, () => ({
    // SearchScreen calls this right before the player opens over an open
    // search: dismissing the keyboard alone leaves a lingering layout inset
    // on some ROMs unless the field also drops logical focus.
    blurSearch: () => searchInputRef.current?.blur(),
  }));

  const barOpacity = useSharedValue(1);
  const barScale = useSharedValue(1);
  const fieldOpacity = useSharedValue(0);
  const fieldScale = useSharedValue(0.78);

  useEffect(() => {
    if (instant) {
      // Tab-entry open: the field is simply THERE — no crossfade to replay
      // (and no half-ghost frame) on a plain tab switch.
      barOpacity.value = searching ? 0 : 1;
      fieldOpacity.value = searching ? 1 : 0;
      barScale.value = 1;
      fieldScale.value = 1;
    } else if (reduced) {
      barOpacity.value = withTiming(searching ? 0 : 1, { duration: 160 });
      fieldOpacity.value = withTiming(searching ? 1 : 0, { duration: 160 });
      barScale.value = 1;
      fieldScale.value = 1;
    } else if (searching) {
      barOpacity.value = withTiming(0, { duration: 200, easing: EASE.settle });
      barScale.value = withTiming(0.88, { duration: 380, easing: EASE.liquid });
      // 60ms delay so the trio clears before the field blooms (web parity);
      // closing mirrors this with no delay.
      fieldOpacity.value = withDelay(60, withTiming(1, { duration: 200, easing: EASE.settle }));
      fieldScale.value = withTiming(1, { duration: 380, easing: EASE.liquid });
    } else {
      barOpacity.value = withTiming(1, { duration: 200, easing: EASE.settle });
      barScale.value = withTiming(1, { duration: 380, easing: EASE.liquid });
      fieldOpacity.value = withTiming(0, { duration: 200, easing: EASE.settle });
      fieldScale.value = withTiming(0.78, { duration: 380, easing: EASE.liquid });
    }
  }, [searching, instant, reduced, barOpacity, barScale, fieldOpacity, fieldScale]);

  // Autofocus on open (120ms — a same-tick focus can miss right after a tab
  // switch on some ROMs); dismiss on close. Skipped when this instance isn't
  // the focused screen — Home/Talk/You keep their own mounted TopBar once
  // visited, and only the one actually on screen should grab the keyboard.
  // Instant (tab-entry) opens don't grab it either: the keyboard rises when
  // the person taps the field, not because they switched tabs.
  useEffect(() => {
    if (!searching) {
      Keyboard.dismiss();
      return undefined;
    }
    if (instant) return undefined;
    if (!(navigation?.isFocused?.() ?? true)) return undefined;
    const id = setTimeout(() => searchInputRef.current?.focus(), 120);
    return () => clearTimeout(id);
  }, [searching, instant, navigation]);

  const onSearchPress = () => {
    openSearch();
    navigation?.navigate('Search');
  };

  const barLayerStyle = useAnimatedStyle(() => ({
    opacity: barOpacity.value,
    transform: [{ scale: barScale.value }],
  }));
  const fieldLayerStyle = useAnimatedStyle(() => ({
    opacity: fieldOpacity.value,
    transform: [{ scale: fieldScale.value }],
  }));

  return (
    <View
      style={[
        styles.wrap,
        float ? styles.float : null,
        { marginTop: insets.top + 10 },
      ]}
    >
      {/* soft = the dock capsule's exact tint register, so the two pieces of
          floating chrome read as the same glass (the ask that landed this:
          "top bar background same as bottom bar"). blur = the real backdrop
          behind it, same as the dock. */}
      <Glass radius={radii.pill} soft blur style={styles.bar}>
        <Animated.View
          pointerEvents={searching ? 'none' : 'auto'}
          importantForAccessibility={searching ? 'no-hide-descendants' : 'auto'}
          style={[styles.layer, styles.row, barLayerStyle]}
        >
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
            onPress={onSearchPress}
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
        </Animated.View>

        {/* Layer 2 — the search field, always mounted (so typing here keeps
            reaching the shared query even while inert) and only interactive
            while open. */}
        <Animated.View
          pointerEvents={searching ? 'auto' : 'none'}
          importantForAccessibility={searching ? 'auto' : 'no-hide-descendants'}
          style={[styles.layer, styles.fieldRow, fieldLayerStyle]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="close search"
            onPress={closeSearch}
            hitSlop={8}
            style={styles.backBtn}
          >
            <Icon name="chevron-left" size={20} color={t.inkSoft} />
          </Pressable>
          <Icon name="search" size={16} color={t.inkFaint} />
          <TextInput
            ref={searchInputRef}
            value={query}
            onChangeText={setQuery}
            placeholder="search a song, artist, or mood…"
            placeholderTextColor={t.inkFaint}
            style={[styles.fieldInput, { color: t.ink }]}
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="search"
            returnKeyType="search"
            onSubmitEditing={onSubmitSearch}
            cursorColor={t.accent}
            selectionColor={t.accent}
          />
          {query.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="clear search"
              onPress={() => {
                setQuery('');
                searchInputRef.current?.focus();
              }}
              hitSlop={8}
              style={styles.clearBtn}
            >
              <Icon name="close" size={16} color={t.inkSoft} />
            </Pressable>
          )}
        </Animated.View>
      </Glass>
    </View>
  );
});

const styles = StyleSheet.create({
  // zIndex keeps the bar painting above the screen's scroller: the rubber-band
  // bounce translates the whole scroller, and without this a card could
  // composite over the translucent bar during an overscroll (field report).
  wrap: { paddingHorizontal: 14, marginBottom: 6, zIndex: 20 },
  float: { position: 'absolute', top: 0, left: 0, right: 0 },
  bar: { height: 52, justifyContent: 'center' },
  brand: { justifyContent: 'center' },
  auraGlow: { position: 'absolute', left: -22, right: -22, top: -8, bottom: -8 },
  // Search-morph layers: absolutely stacked to fill the pill, pivoting on the
  // search chip's corner (web transform-origin) so the swell reads as coming
  // out of it.
  layer: { ...StyleSheet.absoluteFillObject, transformOrigin: 'right center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  backBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  clearBtn: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  fieldInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, padding: 0 },
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
