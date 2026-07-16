import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { PressScale } from '../ui/PressScale';
import { Icon } from '../Icon';
import { TrackArt } from '../TrackRow';
import { fonts, label } from '../../theme/tokens';

// One-tap play-all card for the active listening mode's curated pool, ported
// from web .aura-dh__modemix. Parent gates it on activeMode !== 'everyday'.
// While the pool loads: "curating your {mode} mix…" with a pulsing dot.
export function ModeMixCard({ modeLabel, tracks, loading, onPlayAll }) {
  const { t } = useTheme();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0.4);

  // Cancel on the way out: once the pool lands the dot is no longer rendered,
  // but an uncancelled withRepeat keeps ticking for as long as home is mounted.
  useEffect(() => {
    if (!loading || reduced) {
      return undefined;
    }
    pulse.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
    return () => cancelAnimation(pulse);
  }, [loading, pulse, reduced]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  if (loading) {
    return (
      <View style={styles.pad}>
        <View
          style={[
            styles.card,
            { backgroundColor: t.accentCard, borderColor: t.line },
          ]}
        >
          <Animated.View
            style={[styles.dot, { backgroundColor: t.accent }, dotStyle]}
          />
          <Text style={[styles.sub, { color: t.inkSoft }]}>
            curating your {modeLabel} mix…
          </Text>
        </View>
      </View>
    );
  }
  if (!tracks.length) {
    return null;
  }

  return (
    <View style={styles.pad}>
      <PressScale
        accessibilityRole="button"
        accessibilityLabel={`play ${modeLabel} mix`}
        onPress={onPlayAll}
        style={[
          styles.card,
          { backgroundColor: t.accentCard, borderColor: t.line },
        ]}
      >
        <View style={styles.collage}>
          {tracks.slice(0, 4).map(track => (
            <TrackArt key={track.id} track={track} size={29} radius={4} />
          ))}
        </View>
        <View style={styles.meta}>
          <Text style={[label(11), { color: t.accent }]}>your mix</Text>
          <Text numberOfLines={1} style={[styles.title, { color: t.ink }]}>
            {modeLabel} mix
          </Text>
          <Text style={[styles.sub, { color: t.inkSoft }]}>
            {tracks.length} songs · tap to play all
          </Text>
        </View>
        <View style={[styles.playDisc, { backgroundColor: t.accent }]}>
          <Icon name="play" size={16} color={t.surface} />
        </View>
      </PressScale>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 22 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 76,
  },
  collage: {
    width: 60,
    height: 60,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  meta: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.semibold, fontSize: 17 },
  sub: { fontFamily: fonts.regular, fontSize: 13 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  playDisc: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
