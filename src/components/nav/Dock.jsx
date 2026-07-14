import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { Circle, RoundedRect } from '@shopify/react-native-skia';
import { Icon } from '../Icon';
import { Bead, BEAD_SIZE } from '../player/Bead';
import { Glass } from '../ui/Glass';
import { Goo } from '../ui/Goo';
import { PressScale } from '../ui/PressScale';
import { useTheme } from '../../theme/ThemeContext';
import { usePlayer } from '../../playback/PlayerContext';
import { gooFill, label, radii } from '../../theme/tokens';
import { DUR, EASE } from '../../theme/motion';

const TAB_ICONS = { Home: 'home', Search: 'search', Talk: 'chat', You: 'user' };

// How much vertical room the floating chrome needs under scrolling content.
export const DOCK_CLEARANCE = 96;

// Goo canvas bleeds past the dock so the blur has room to merge shapes.
const GOO_PAD = 14;
const GOO_WINDOW_MS = 460;

function DockTab({ route, focused, label: tabLabel, tint, accent, onPress }) {
  const reduced = useReducedMotion();
  const dot = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    dot.value = reduced
      ? focused
        ? 1
        : 0
      : withTiming(focused ? 1 : 0, { duration: DUR.dot, easing: EASE.settle });
  }, [focused, dot, reduced]);
  const dotStyle = useAnimatedStyle(() => ({ transform: [{ scale: dot.value }] }));

  return (
    <PressScale
      accessibilityRole="button"
      accessibilityState={focused ? { selected: true } : {}}
      accessibilityLabel={tabLabel}
      onPress={onPress}
      style={styles.tab}
    >
      <Icon name={TAB_ICONS[route.name]} size={22} color={tint} />
      <Text style={[label(7.5), { color: tint }]}>{tabLabel}</Text>
      <Animated.View style={[styles.dot, { backgroundColor: accent }, dotStyle]} />
    </PressScale>
  );
}

// The web's "mercury dock": a floating glass capsule with the now-playing bead
// budding off its left end. Content scrolls underneath (screens pad by
// DOCK_CLEARANCE); when a track loads the bead metaball-fuses out of the capsule.
export function Dock({ state, descriptors, navigation }) {
  const { name, t } = useTheme();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const reduced = useReducedMotion();
  const hasTrack = !!player.current;

  const [width, setWidth] = useState(0);
  const [gooActive, setGooActive] = useState(false);
  const firstRender = useRef(true);
  const budR = useSharedValue(BEAD_SIZE / 2);

  // Bud window: when a track first appears, draw opaque silhouettes (capsule +
  // growing bead) through the goo filter so the two masses fuse like liquid,
  // then swap the real glass back in.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (hasTrack && !reduced) {
      setGooActive(true);
      budR.value = BEAD_SIZE * 0.1;
      budR.value = withTiming(BEAD_SIZE / 2, { duration: DUR.bud, easing: EASE.settle });
      const id = setTimeout(() => setGooActive(false), GOO_WINDOW_MS);
      return () => clearTimeout(id);
    }
    setGooActive(false);
  }, [hasTrack, budR, reduced]);

  // Tabs slide right to clear the bead (web: padding-left 60).
  const padLeft = useSharedValue(hasTrack ? 60 : 4);
  useEffect(() => {
    padLeft.value = withTiming(hasTrack ? 60 : 4, { duration: DUR.bud, easing: EASE.settle });
  }, [hasTrack, padLeft]);
  const rowStyle = useAnimatedStyle(() => ({ paddingLeft: padLeft.value }));

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { paddingBottom: insets.bottom + 16 }]}
    >
      <View
        pointerEvents="box-none"
        style={styles.slot}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        {gooActive && width > 0 && (
          <Goo
            variant="subtle"
            style={[
              styles.goo,
              { left: -GOO_PAD, right: -GOO_PAD, top: -GOO_PAD, bottom: -GOO_PAD },
            ]}
          >
            <RoundedRect
              x={GOO_PAD}
              y={GOO_PAD}
              width={width}
              height={52}
              r={radii.dock}
              color={gooFill[name]}
            />
            <Circle
              cx={GOO_PAD + 4 + BEAD_SIZE / 2}
              cy={GOO_PAD + 26}
              r={budR}
              color={gooFill[name]}
            />
          </Goo>
        )}
        <Glass radius={radii.dock} solid={gooActive} style={styles.capsule}>
          <Animated.View style={[styles.row, rowStyle]}>
            {state.routes.map((route, i) => {
              const focused = state.index === i;
              const { options } = descriptors[route.key];
              const tabLabel = options.tabBarLabel ?? route.name.toLowerCase();
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
                <DockTab
                  key={route.key}
                  route={route}
                  focused={focused}
                  label={tabLabel}
                  tint={focused ? t.accent : t.inkFaint}
                  accent={t.accent}
                  onPress={onPress}
                />
              );
            })}
          </Animated.View>
        </Glass>
        {hasTrack && (
          <View style={[styles.beadSlot, gooActive && styles.hidden]}>
            <Bead />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    backgroundColor: 'transparent',
  },
  slot: { position: 'relative' },
  goo: { position: 'absolute', zIndex: 1 },
  capsule: { height: 52, justifyContent: 'center' },
  row: { flexDirection: 'row', paddingRight: 4 },
  tab: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 6 },
  dot: { position: 'absolute', bottom: -1, width: 4, height: 4, borderRadius: 2 },
  beadSlot: { position: 'absolute', left: 4, top: 0, zIndex: 2 },
  hidden: { opacity: 0 },
});
