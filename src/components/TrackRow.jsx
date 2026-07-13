import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { cleanTitle } from '../utils/title';

// Catalog image urls carry an "NxN" size token (e.g. ..._150x150.jpg) — swap
// it so lists load the small variant and the player the large one.
function artUrl(track, res = 150) {
  const url = track?.imageUrl;
  return url ? url.replace(/\d+x\d+/, `${res}x${res}`) : null;
}

// Cover thumb with a lettered fallback when there's no image (or it 404s) —
// never a broken-image glyph. `round` renders artist avatars.
export function TrackArt({ track, size = 48, radius = 8, res = 150, round = false }) {
  const { t } = useTheme();
  const [failed, setFailed] = useState(false);
  const uri = failed ? null : artUrl(track, res);
  const shape = {
    width: size,
    height: size,
    borderRadius: round ? size / 2 : radius,
  };
  if (!uri) {
    const letter = (track?.title ?? track?.name ?? '·').trim()[0] ?? '·';
    return (
      <View style={[styles.fallback, shape, { backgroundColor: t.accentSoft }]}>
        <Text style={[styles.letter, { color: t.accent, fontSize: size * 0.4 }]}>
          {letter.toLowerCase()}
        </Text>
      </View>
    );
  }
  return (
    <Image source={{ uri }} onError={() => setFailed(true)} style={shape} />
  );
}

// One list row: art, title, artist; press plays. The right-side context
// affordance (⋯ menu) is omitted in Phase 1.
export function TrackRow({ track, onPress, active = false }) {
  const { t } = useTheme();
  const title = cleanTitle(track.title);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`play ${title}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <TrackArt track={track} size={48} radius={8} />
      <View style={styles.meta}>
        <Text
          numberOfLines={1}
          style={[styles.title, { color: active ? t.accent : t.ink }]}>
          {title}
        </Text>
        {!!track.artist && (
          <Text numberOfLines={1} style={[styles.artist, { color: t.inkSoft }]}>
            {track.artist}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 7,
  },
  pressed: {
    opacity: 0.6,
  },
  meta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '500',
  },
  artist: {
    fontSize: 12.5,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    fontWeight: '600',
  },
});
