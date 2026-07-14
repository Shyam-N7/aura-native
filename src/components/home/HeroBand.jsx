import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { PressScale } from '../ui/PressScale';
import { GradientBg } from '../ui/GradientBg';
import { Icon } from '../Icon';
import { TrackArt } from '../TrackRow';
import { Skeleton } from './Skeleton';
import { fonts, label, radii } from '../../theme/tokens';
import { artUrl } from '../../utils/artUrl';
import { cleanTitle } from '../../utils/title';

// "The set · tonight" opener card built from pool[0], ported from web
// HeroBand.jsx (mobile variant: headline + artist line + begin pill over the
// blurred track art). Tapping anywhere queues the ENTIRE pool from the top.
export function HeroBand({ track, loading, onBegin }) {
  const { t } = useTheme();

  if (loading) {
    return <Skeleton height={200} radius={18} style={styles.pad} />;
  }
  if (!track) {
    return null;
  }

  const backdrop = artUrl(track, 500);
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
            blurRadius={28}
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
            <Text style={[label(9), styles.light70]}>the set · tonight</Text>
            <Text numberOfLines={2} style={styles.headline}>
              {cleanTitle(track.title)}
            </Text>
            {!!track.artist && (
              <Text numberOfLines={1} style={[styles.artist, styles.light70]}>
                {track.artist}
              </Text>
            )}
            <View style={styles.beginPill}>
              <View style={[styles.beginDisc, { backgroundColor: t.accent }]}>
                <Icon name="play" size={10} color="#fff" />
              </View>
              <Text style={[label(9), styles.beginText]}>begin the set</Text>
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
    color: '#fff',
  },
  artist: { fontFamily: fonts.regular, fontSize: 13 },
  light70: { color: 'rgba(255,255,255,0.72)' },
  beginPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
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
  beginText: { color: '#1a1612' },
});
