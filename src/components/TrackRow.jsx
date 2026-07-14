import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Icon } from './Icon';
import { openTrackActions } from '../lib/trackActionsSheet';
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

// One list row: art, title, artist; press plays. `menu` ({ omit, extras })
// adds the ⋯ button + long-press into the track actions sheet.
export function TrackRow({ track, onPress, active = false, menu }) {
  const { t } = useTheme();
  const title = cleanTitle(track.title);
  const openMenu = menu ? () => openTrackActions({ track, menu }) : undefined;
  return (
    <View style={styles.rowWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`play ${title}`}
        onPress={onPress}
        onLongPress={openMenu}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <TrackArt track={track} size={48} radius={8} />
        <View style={styles.meta}>
          <Text
            numberOfLines={1}
            style={[styles.title, { color: active ? t.accent : t.ink }]}>
            {title}
          </Text>
          {!!track.artist && (
            <Text
              numberOfLines={1}
              style={[styles.artist, { color: t.inkSoft }]}>
              {track.artist}
            </Text>
          )}
        </View>
      </Pressable>
      {menu && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="more"
          onPress={openMenu}
          hitSlop={8}
          style={({ pressed }) => [styles.more, pressed && styles.pressed]}>
          <Icon name="dots" size={17} color={t.inkFaint} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  rowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 7,
  },
  more: {
    paddingVertical: 10,
    paddingLeft: 8,
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
    fontFamily: 'HankenGrotesk-Medium',
    fontSize: 15,
  },
  artist: {
    fontFamily: 'HankenGrotesk-Regular',
    fontSize: 12.5,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    fontFamily: 'HankenGrotesk-SemiBold',
  },
});
