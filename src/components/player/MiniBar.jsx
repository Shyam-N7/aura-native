import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { usePlayer } from '../../playback/PlayerContext';
import { TrackArt } from '../TrackRow';
import { Icon } from '../Icon';
import { cleanTitle } from '../../utils/title';

// Collapsed now-playing strip that sits directly above the dock pill while a
// track is loaded. Tapping it opens the full player sheet.
export function MiniBar() {
  const { t } = useTheme();
  const player = usePlayer();
  const track = player.current;
  if (!track) {
    return null;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="open player"
      onPress={() => player.ui?.openPlayer?.()}
      style={[styles.bar, { backgroundColor: t.surface, borderColor: t.line }]}>
      <TrackArt track={track} size={38} radius={7} />
      <Text numberOfLines={1} style={[styles.title, { color: t.ink }]}>
        {cleanTitle(track.title)}
        {track.artist ? (
          <Text style={{ color: t.inkSoft }}> · {track.artist}</Text>
        ) : null}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={player.isPlaying ? 'pause' : 'play'}
        onPress={player.togglePlay}
        hitSlop={10}
        style={styles.toggle}>
        <Icon
          name={player.isPlaying ? 'pause' : 'play'}
          size={22}
          color={t.ink}
        />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  title: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '500',
  },
  toggle: {
    paddingHorizontal: 4,
  },
});
