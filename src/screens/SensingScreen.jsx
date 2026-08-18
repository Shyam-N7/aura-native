import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeContext';
import { getCurrentMood } from '../api/mood';
import { getTopArtists } from '../api/stats';
import { partOfDay } from '../lib/sensing';
import { fonts, label } from '../theme/tokens';

// A gentle time-of-day vibe word for the reveal when there's no confident mood
// read — a vibe, not a claimed personal mood (no invented "sensing").
const PART_VIBE = {
  morning: 'Fresh',
  afternoon: 'Easy',
  evening: 'Warm',
  night: 'Quiet',
};

// The ~6s welcome intro (web SensingScreen). Snapshots a greeting at mount,
// reads the live mood + a listening recap (best-effort — never waits on the
// network), unfolds four lines, then reveals the mood in large serif. Tap
// anywhere to skip. onReady fires once (here, or at the 5.9s mark).
export function SensingScreen({ name, onReady }) {
  const { t } = useTheme();
  const reduced = useReducedMotion();

  const [intro] = useState(() => {
    const part = partOfDay();
    const who = (name || '').trim().split(/\s+/)[0];
    return {
      greeting: who ? `Good ${part}, ${who.toLowerCase()}` : `Good ${part}`,
      part,
    };
  });
  const [snapshot, setSnapshot] = useState(null);
  const [recap, setRecap] = useState(null);

  useEffect(() => {
    const ctl = new AbortController();
    getCurrentMood({ signal: ctl.signal }).then(setSnapshot).catch(() => {});
    getTopArtists({ limit: 1, days: 30, signal: ctl.signal })
      .then(list => {
        const top = list?.[0]?.artist;
        if (top) {
          setRecap(`Back on a ${top} run`);
        }
      })
      .catch(() => {});
    return () => ctl.abort();
  }, []);

  const confident = snapshot?.mood && snapshot.confidence >= 0.5;
  const liveMood = confident ? snapshot.mood : PART_VIBE[intro.part] ?? 'Here';
  const reason = confident ? snapshot.reason : null;

  const lines = [
    intro.greeting,
    'Reading the moment',
    recap || `Matching tracks to your ${intro.part}`,
    'Almost there',
  ];
  const lineAt = [200, 1100, 2000, 2900];
  const [shown, setShown] = useState(0);
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    const tt = lineAt.map((ms, i) => setTimeout(() => setShown(i + 1), ms));
    const r = setTimeout(() => setReveal(true), 3700);
    const d = setTimeout(onReady, 5900);
    return () => {
      tt.forEach(clearTimeout);
      clearTimeout(r);
      clearTimeout(d);
    };
    // One-shot: timings + onReady are stable; line text reads from live render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Breathing accent orb + ring.
  const breathe = useSharedValue(0);
  useEffect(() => {
    if (reduced) {
      breathe.value = 0.5;
      return undefined;
    }
    breathe.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => cancelAnimation(breathe);
  }, [reduced, breathe]);
  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.3 + breathe.value * 0.4,
    transform: [{ scale: 0.9 + breathe.value * 0.2 }],
  }));
  const orbStyle = useAnimatedStyle(() => ({
    opacity: 0.7 + breathe.value * 0.3,
    transform: [{ scale: 0.85 + breathe.value * 0.25 }],
  }));

  const revealStyle = useAnimatedStyle(() => ({
    opacity: withTiming(reveal ? 1 : 0, { duration: 600 }),
    transform: [{ translateY: withTiming(reveal ? 0 : 14, { duration: 600 }) }],
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="skip intro"
      onPress={onReady}
      style={[styles.root, { backgroundColor: t.bg }]}
    >
      <View style={styles.topRow}>
        <View style={[styles.dot, { backgroundColor: t.accent }]} />
        <Text style={[label(10), { color: t.inkSoft }]}>Sensing</Text>
      </View>

      <View style={styles.center}>
        <Animated.View
          style={[styles.ring, { borderColor: t.accent }, ringStyle]}
        />
        <Animated.View
          style={[styles.orb, { backgroundColor: t.accent }, orbStyle]}
        />
      </View>

      <View style={styles.lines}>
        {lines.slice(0, shown).map((l, i) => (
          <Animated.Text
            key={i}
            entering={FadeIn.duration(400)}
            style={[styles.line, { color: t.inkSoft }]}
          >
            {l}
          </Animated.Text>
        ))}
      </View>

      <View style={styles.moodBlock}>
        <Text style={[label(9), { color: t.inkFaint }]}>Your mood</Text>
        <Animated.Text style={[styles.mood, { color: t.ink }, revealStyle]}>
          {liveMood}.
        </Animated.Text>
        <Animated.Text
          style={[styles.tagline, { color: t.inkFaint }, revealStyle]}
        >
          {reveal && reason ? reason : 'Setting up your home…'}
        </Animated.Text>
      </View>

      <Text style={[label(9), styles.skip, { color: t.inkFaint }]}>
        Tap to skip
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingTop: 72,
    paddingBottom: 40,
    paddingHorizontal: 32,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 1,
  },
  orb: { width: 16, height: 16, borderRadius: 8 },
  lines: { gap: 8, minHeight: 110 },
  line: { fontFamily: fonts.regular, fontSize: 14 },
  moodBlock: { marginTop: 28, minHeight: 110 },
  mood: {
    fontFamily: 'Fraunces-Regular',
    fontSize: 64,
    lineHeight: 66,
    letterSpacing: -1.28,
    marginTop: 6,
  },
  tagline: { fontFamily: fonts.regular, fontSize: 13, marginTop: 14 },
  skip: { textAlign: 'center', marginTop: 16 },
});
