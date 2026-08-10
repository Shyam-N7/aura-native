import React, { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { fonts, type } from '../theme/tokens';
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
//
// Memoized because this mounts once per row in every long list in the app, and
// its parents re-render for reasons that have nothing to do with the artwork.
export const TrackArt = React.memo(function TrackArt({
  track,
  size = 48,
  radius = 8,
  res = 150,
  round = false,
}) {
  const { t } = useTheme();
  const [failed, setFailed] = useState(false);
  const uri = failed ? null : artUrl(track, res);
  const shape = useMemo(
    () => ({
      width: size,
      height: size,
      borderRadius: round ? size / 2 : radius,
    }),
    [size, radius, round],
  );
  // Both memoized so a re-render hands the native Image the SAME props and it
  // has nothing to diff — a fresh {uri} object per render is a prop change to
  // the view even when the string never moved.
  const source = useMemo(() => (uri ? { uri } : null), [uri]);
  const onError = useCallback(() => setFailed(true), []);
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
  // resizeMethod="resize" decodes at roughly the view size. Catalog art is
  // already served small via the url token, but token-less sources (custom
  // playlist covers are whatever the member uploaded — camera photos) would
  // otherwise decode at full resolution: tens of MB for a 48px thumb, on the
  // phone this app keeps getting OOM-killed on.
  return (
    <Image
      source={source}
      onError={onError}
      resizeMethod="resize"
      // Android fades every image in over 300ms by default. Scrolling a long
      // list mounts cells continuously — a fling starts a dozen of these per
      // batch, each an animation the UI thread has to run while it is already
      // busy committing rows. The art is a 54px thumb; nobody is watching it
      // arrive.
      fadeDuration={0}
      style={shape}
    />
  );
});

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
  // type.rowTitle spelled out — the token exists for exactly this row and
  // read as unused because every list bypassed it.
  title: type.rowTitle,
  artist: {
    fontFamily: fonts.regular,
    fontSize: 12.5,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    fontFamily: fonts.semibold,
  },
});
