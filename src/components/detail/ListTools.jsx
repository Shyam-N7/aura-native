import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { RoundedRect } from '@shopify/react-native-skia';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { useAppActive } from '../../hooks/useAppActive';
import { useNavFocused } from '../../hooks/useNavFocused';
import { Goo } from '../ui/Goo';
import { Icon } from '../Icon';
import { fonts, label } from '../../theme/tokens';

// Find-in-list + sort for track collections (liked songs, playlist details).
// One morphing row: the sort options live in a gooey segmented slider — the
// active pill is a liquid accent blob that stretches between segments (a fast
// head + a slow tail, fused by the dock's metaball filter). A round search
// button sits at the right; tapping it slides the find field open over the
// slider (the button becomes a cancel). The screen owns query/sort state.
const H = 44; // row height
const TOGGLE = 40; // search/cancel button diameter
const ZONE_RIGHT = TOGGLE + 8; // room the button reserves at the right edge
const BLOB_H = 30; // slider indicator height (blur bleeds within the canvas)
const CY = H / 2; // indicator vertical centre

// Head springs stiff+fast to the tapped segment; tail trails soft+slow. While
// they're apart the goo threshold bridges them — the pill reads as liquid.
const HEAD = { mass: 1, stiffness: 210, damping: 20 };
const TAIL = { mass: 1, stiffness: 120, damping: 17 };

export function ListTools({ query, onQuery, sort, onSort, sorts }) {
  const { t } = useTheme();
  const reduced = useReducedMotion();
  const inputRef = useRef(null);
  const [w, setW] = useState(0); // measured slider-track width
  const [ready, setReady] = useState(false); // indicator placed at least once
  const [searching, setSearching] = useState(false);

  const active = Math.max(
    0,
    sorts.findIndex(s => s.id === sort),
  );
  const seg = w > 0 ? w / sorts.length : 0;
  const bw = seg > 10 ? seg - 8 : Math.max(seg * 0.7, 8);

  const head = useSharedValue(0); // indicator head centre-x
  const tail = useSharedValue(0); // indicator tail centre-x
  const pulse = useSharedValue(0); // idle height breathing
  const open = useSharedValue(0); // 0 slider · 1 search field
  const lastW = useRef(0);

  // Idle breathing so the pill feels liquid even at rest — but only while it
  // can be seen: the native stack keeps parked detail screens mounted, so an
  // unfocused/backgrounded breathe would keep the window (and the glass
  // captures) hot every frame under whatever covers it.
  const appActive = useAppActive();
  const focused = useNavFocused();
  useEffect(() => {
    if (reduced || !appActive || !focused) {
      cancelAnimation(pulse);
      pulse.value = withTiming(0, { duration: 200 });
      return undefined;
    }
    pulse.value = withRepeat(
      withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => cancelAnimation(pulse);
  }, [reduced, appActive, focused, pulse]);

  // Move the indicator to the active segment: instant on first layout / width
  // change, spring otherwise (so a re-sort glides, a rotate snaps).
  useEffect(() => {
    if (!seg) {
      return;
    }
    const c = seg * (active + 0.5);
    const instant = reduced || lastW.current !== w;
    lastW.current = w;
    if (instant) {
      head.value = c;
      tail.value = c;
    } else {
      head.value = withSpring(c, HEAD);
      tail.value = withSpring(c, TAIL);
    }
    setReady(true);
  }, [w, seg, active, reduced, head, tail]);

  useEffect(() => {
    return () => {
      cancelAnimation(head);
      cancelAnimation(tail);
    };
  }, [head, tail]);

  useEffect(() => {
    if (reduced) {
      open.value = searching ? 1 : 0;
      return;
    }
    open.value = withTiming(searching ? 1 : 0, {
      duration: 240,
      easing: Easing.out(Easing.cubic),
    });
  }, [searching, reduced, open]);

  // Skia reads these derived values directly (the dock-bead pattern).
  const bh = useDerivedValue(
    () => BLOB_H + (reduced ? 0 : Math.sin(pulse.value * Math.PI * 2) * 1.5),
    [reduced],
  );
  const by = useDerivedValue(() => CY - bh.value / 2);
  const br = useDerivedValue(() => bh.value / 2);
  const hx = useDerivedValue(() => head.value - bw / 2, [bw]);
  const tx = useDerivedValue(() => tail.value - bw / 2, [bw]);

  const sliderStyle = useAnimatedStyle(() => ({ opacity: 1 - open.value }));
  const fieldStyle = useAnimatedStyle(() => ({
    opacity: open.value,
    transform: [{ translateX: (1 - open.value) * 10 }],
  }));

  const openSearch = () => {
    setSearching(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const closeSearch = () => {
    onQuery('');
    inputRef.current?.blur();
    setSearching(false);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Animated.View
          style={[styles.zone, sliderStyle]}
          pointerEvents={searching ? 'none' : 'auto'}
        >
          <View
            style={[
              styles.track,
              { backgroundColor: t.surface, borderColor: t.line },
            ]}
            onLayout={e => setW(e.nativeEvent.layout.width)}
          >
            {w > 0 && ready && (
              <Goo variant="subtle" style={styles.goo}>
                <RoundedRect
                  x={hx}
                  y={by}
                  width={bw}
                  height={bh}
                  r={br}
                  color={t.accentCard}
                />
                <RoundedRect
                  x={tx}
                  y={by}
                  width={bw}
                  height={bh}
                  r={br}
                  color={t.accentCard}
                />
              </Goo>
            )}
            <View style={styles.segRow}>
              {sorts.map(s => {
                const on = s.id === sort;
                return (
                  <Pressable
                    key={s.id}
                    accessibilityRole="button"
                    accessibilityLabel={`sort by ${s.label}`}
                    accessibilityState={on ? { selected: true } : {}}
                    onPress={() => onSort(s.id)}
                    style={styles.seg}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        label(9),
                        { color: on ? t.accent : t.inkSoft },
                      ]}
                    >
                      {s.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </Animated.View>

        <Animated.View
          style={[styles.zone, fieldStyle]}
          pointerEvents={searching ? 'auto' : 'none'}
        >
          <View
            style={[
              styles.field,
              { backgroundColor: t.surface, borderColor: t.line },
            ]}
          >
            <Icon name="search" size={15} color={t.inkFaint} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={onQuery}
              placeholder="find in songs"
              placeholderTextColor={t.inkFaint}
              cursorColor={t.accent}
              selectionColor={t.accent}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="find in songs"
              style={[styles.input, { color: t.ink }]}
            />
          </View>
        </Animated.View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={searching ? 'close search' : 'search list'}
          onPress={searching ? closeSearch : openSearch}
          hitSlop={8}
          style={({ pressed }) => [
            styles.toggle,
            { backgroundColor: t.surface, borderColor: t.line },
            pressed && styles.pressed,
          ]}
        >
          <Icon
            name={searching ? 'close' : 'search'}
            size={17}
            color={searching ? t.accent : t.inkSoft}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12 },
  row: { height: H, justifyContent: 'center' },
  // Slider and field share the row, each leaving room for the toggle button.
  zone: {
    position: 'absolute',
    left: 0,
    right: ZONE_RIGHT,
    top: 0,
    bottom: 0,
  },
  track: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    overflow: 'hidden',
  },
  goo: { ...StyleSheet.absoluteFillObject },
  segRow: { flex: 1, flexDirection: 'row' },
  seg: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    paddingVertical: 0,
  },
  toggle: {
    position: 'absolute',
    right: 0,
    width: TOGGLE,
    height: TOGGLE,
    borderRadius: TOGGLE / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
});
