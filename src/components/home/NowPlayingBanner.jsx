import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  useReducedMotion,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { useAppActive } from '../../hooks/useAppActive';
import { useNavFocused } from '../../hooks/useNavFocused';
import { PressScale } from '../ui/PressScale';
import { TrackArt } from '../TrackRow';
import { fonts, label } from '../../theme/tokens';
import { cleanTitle } from '../../utils/title';
import { DUR, EASE } from '../../theme/motion';

// Three deterministic 0..1 lanes from the track id — the song's own tempo of
// sway (the ProgressRibbon trick: seeded character, no faked beat detection).
/* eslint-disable no-bitwise */
const seedLanes = id => {
  const s = String(id ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0;
  }
  return [
    (h & 1023) / 1023,
    ((h >>> 10) & 1023) / 1023,
    ((h >>> 20) & 1023) / 1023,
  ];
};
/* eslint-enable no-bitwise */

// The card's right side holds a small LIVING version of the AURA mark: the
// launcher icon's concentric rings, breathing and swaying while the music
// plays, settling still when it pauses. Ring tempo, sway depth and phase are
// seeded from the track id, so every song's aura dances a little differently.
// Rings breathe asymmetrically (x grows as y eases) — an organic wobble, not
// a mechanical pulse. Purely decorative: no touches, hidden from a11y.
function AuraDance({ id, playing, reduced }) {
  const { t } = useTheme();
  // These loops are gated on `playing`, so with the screen off they'd dance
  // unseen for the whole listen — one of the reports/10 leak drivers. Settle
  // whenever the app isn't visible, same as a pause — and whenever Home is
  // parked behind another tab, where the dance would invisibly keep the
  // window (and the glass captures) hot every frame.
  const active = useAppActive();
  const focused = useNavFocused();
  const w0 = useSharedValue(0); // outer ring sway, -1..1
  const w1 = useSharedValue(0); // inner ring sway, offset phase
  const beat = useSharedValue(0); // core pulse, 0..1
  const lanes = useMemo(() => seedLanes(id), [id]);

  useEffect(() => {
    const waves = [w0, w1];
    if (reduced || !playing || !active || !focused) {
      // Settle to the resting mark — the logo, holding its breath.
      [...waves, beat].forEach(v => {
        cancelAnimation(v);
        v.value = withTiming(0, { duration: 400, easing: EASE.settle });
      });
      return;
    }
    waves.forEach((w, i) => {
      const dur = 2300 + lanes[i] * 1500 + i * 320;
      cancelAnimation(w);
      w.value = withDelay(
        i * 240,
        withRepeat(
          withSequence(
            withTiming(1, {
              duration: dur / 2,
              easing: Easing.inOut(Easing.sin),
            }),
            withTiming(-1, {
              duration: dur / 2,
              easing: Easing.inOut(Easing.sin),
            }),
          ),
          -1,
          true,
        ),
      );
    });
    cancelAnimation(beat);
    beat.value = withRepeat(
      withSequence(
        withTiming(1, {
          duration: 640 + lanes[2] * 520,
          easing: Easing.inOut(Easing.sin),
        }),
        withTiming(0, {
          duration: 760 + lanes[2] * 420,
          easing: Easing.inOut(Easing.sin),
        }),
      ),
      -1,
      true,
    );
  }, [lanes, playing, reduced, active, focused, w0, w1, beat]);

  const a0 = 0.05 + lanes[0] * 0.05;
  const a1 = 0.08 + lanes[1] * 0.06;
  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.05 + 0.05 * (w0.value + 1) * 0.5 + beat.value * 0.05,
    transform: [{ scale: 1 + 0.1 * w0.value }],
  }));
  const r0 = useAnimatedStyle(() => ({
    opacity: 0.34 + 0.1 * w0.value,
    transform: [
      { scaleX: 1 + a0 * w0.value },
      { scaleY: 1 - a0 * 0.7 * w0.value },
    ],
  }));
  const r1 = useAnimatedStyle(() => ({
    opacity: 0.48 + 0.12 * w1.value,
    transform: [
      { scaleX: 1 - a1 * 0.7 * w1.value },
      { scaleY: 1 + a1 * w1.value },
    ],
  }));
  const coreStyle = useAnimatedStyle(() => ({
    opacity: 0.75 + 0.25 * beat.value,
    transform: [{ scale: 0.85 + 0.3 * beat.value }],
  }));

  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      style={styles.aura}
    >
      <Animated.View
        style={[styles.auraGlow, { backgroundColor: t.accent }, glowStyle]}
      />
      <Animated.View
        style={[styles.ring, styles.ring0, { borderColor: t.ink }, r0]}
      />
      <Animated.View
        style={[styles.ring, styles.ring1, { borderColor: t.ink }, r1]}
      />
      <Animated.View
        style={[styles.core, { backgroundColor: t.accent }, coreStyle]}
      />
    </View>
  );
}

// Now-playing hero card — tap re-opens the full player. On a track change the
// card interior takes a step with the direction of travel (forward arrives
// from the right, back from the left — the home end of the player's
// filmstrip); a directionless change just fades in place. Shared-value glide
// on the mounted view, not a keyed entering animation — that class aborts
// natively when the card unmounts mid-flight.
export function NowPlayingBanner({ track, dir = 0, playing = false, onOpen }) {
  const { t } = useTheme();
  const reduced = useReducedMotion();
  const m = useSharedValue(1);
  const d = useSharedValue(0);
  const prev = useRef(track?.id);
  useEffect(() => {
    if (!track?.id || track.id === prev.current) {
      return;
    }
    prev.current = track.id;
    if (reduced) {
      return;
    }
    d.value = dir;
    m.value = 0;
    m.value = withTiming(1, { duration: DUR.upNext, easing: EASE.enter });
  }, [track, dir, reduced, m, d]);
  const glide = useAnimatedStyle(() => ({
    opacity: m.value,
    transform: [{ translateX: (1 - m.value) * d.value * 34 }],
  }));

  if (!track) {
    return null;
  }
  return (
    <View style={styles.pad}>
      <PressScale
        accessibilityRole="button"
        accessibilityLabel="now playing, open player"
        onPress={onOpen}
        style={[
          styles.card,
          { backgroundColor: t.surface, borderColor: t.line },
        ]}
      >
        <Animated.View style={[styles.inner, glide]}>
          <TrackArt track={track} size={64} radius={12} />
          <View style={styles.meta}>
            <Text style={[label(9), { color: t.accent }]}>now playing</Text>
            <Text numberOfLines={1} style={[styles.title, { color: t.ink }]}>
              {cleanTitle(track.title)}
            </Text>
            {!!track.artist && (
              <Text
                numberOfLines={1}
                style={[styles.artist, { color: t.inkSoft }]}
              >
                {track.artist}
              </Text>
            )}
          </View>
          <AuraDance id={track.id} playing={playing} reduced={reduced} />
        </Animated.View>
      </PressScale>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 22 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  meta: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.semibold, fontSize: 17 },
  artist: { fontFamily: fonts.regular, fontSize: 13 },
  // The living mark — sized to the art so the card reads balanced end to end.
  aura: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  auraGlow: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 999,
  },
  ring: {
    position: 'absolute',
    borderRadius: 999,
  },
  ring0: { width: 54, height: 54, borderWidth: 1.25 },
  ring1: { width: 33, height: 33, borderWidth: 1.5 },
  core: { width: 13, height: 13, borderRadius: 999 },
});
