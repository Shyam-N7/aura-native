import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { PressScale } from '../ui/PressScale';
import { GradientBg } from '../ui/GradientBg';
import { Icon } from '../Icon';
import { TrackArt } from '../TrackRow';
import { Skeleton } from '../ui/Skeleton';
import { fonts, label, radii } from '../../theme/tokens';
import { artUrl } from '../../utils/artUrl';
import { cleanTitle } from '../../utils/title';

// "The set · tonight" opener card built from pool[0], ported from web
// HeroBand.jsx (mobile variant: headline + artist line + begin pill over the
// blurred track art). Tapping anywhere queues the ENTIRE pool from the top.
export function HeroBand({ track, reason, loading, onBegin }) {
  const { t, name } = useTheme();
  // Everything here rides blurred cover art under a dark gradient, so the copy
  // and the begin pill must read LIGHT in every theme: that's `surface` on the
  // light themes and `ink` on midnight. `onArtInk` is its inverse — the dark
  // ink that sits ON the light pill (midnight's `bg`, the old #1a1612).
  const onArt = name === 'midnight' ? t.ink : t.surface;
  const onArtInk = name === 'midnight' ? t.bg : t.ink;

  if (loading) {
    return <Skeleton height={200} radius={18} style={styles.pad} />;
  }
  if (!track) {
    return null;
  }
  // A personalized hero wears its receipt ("you keep coming back to this");
  // the featured fallback keeps the editorial "the set · tonight" label.
  const eyebrow = reason ?? 'the set · tonight';

  // Blurred to a wash — 150px decodes/blurs ~11× cheaper than 500px, and
  // radius 8/150 ≈ the old 28/500. The sharp 92px art below stays at 500.
  const backdrop = artUrl(track, 150);
  return (
    <View style={styles.pad}>
      <PressScale
        accessibilityRole="button"
        accessibilityLabel="begin the set"
        onPress={onBegin}
        style={styles.card}
      >
        {backdrop && (
          <Image
            source={{ uri: backdrop }}
            blurRadius={8}
            style={StyleSheet.absoluteFill}
          />
        )}
        <GradientBg
          angle={180}
          stops={[
            { offset: 0, color: '#000', opacity: 0.28 },
            { offset: 1, color: '#000', opacity: 0.58 },
          ]}
        />
        <View style={styles.inner}>
          <TrackArt
            track={track}
            size={92}
            radius={radii.playerArt}
            res={500}
          />
          <View style={styles.copy}>
            <Text numberOfLines={1} style={[label(9), styles.light70]}>
              {eyebrow}
            </Text>
            <Text numberOfLines={2} style={[styles.headline, { color: onArt }]}>
              {cleanTitle(track.title)}
            </Text>
            {!!track.artist && (
              <Text numberOfLines={1} style={[styles.artist, styles.light70]}>
                {track.artist}
              </Text>
            )}
            <View style={[styles.beginPill, { backgroundColor: onArt }]}>
              <View style={[styles.beginDisc, { backgroundColor: t.accent }]}>
                {/* On the accent disc, not on art — the app's on-accent ink. */}
                <Icon name="play" size={10} color={t.bg} />
              </View>
              <Text style={[label(9), { color: onArtInk }]}>Begin the set</Text>
            </View>
          </View>
        </View>
      </PressScale>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 22 },
  card: {
    minHeight: 180,
    borderRadius: 18,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 20,
  },
  copy: { flex: 1, gap: 4 },
  headline: {
    fontFamily: fonts.semibold,
    fontSize: 24,
    lineHeight: 27,
  },
  artist: { fontFamily: fonts.regular, fontSize: 13 },
  // Deliberate literal: the eyebrow/artist line is a FADED light ink over the
  // art, and no theme carries a light-with-alpha token (dusk/bloom's inkSoft
  // is dark ink) — tokenizing this would bury it on the two light themes.
  light70: { color: 'rgba(255,255,255,0.72)' },
  beginPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  beginDisc: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
