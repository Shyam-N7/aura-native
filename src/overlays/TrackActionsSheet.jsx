import React, { useContext, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainerRefContext } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { useLikes } from '../hooks/useLikes';
import {
  closeTrackActions,
  subscribeTrackActions,
} from '../lib/trackActionsSheet';
import { openAddToPlaylist } from '../lib/addToPlaylistSheet';
import { showToast } from '../lib/toast';
import { TrackArt } from '../components/TrackRow';
import { Icon } from '../components/Icon';
import { fonts, radii } from '../theme/tokens';
import { DUR } from '../theme/motion';
import { cleanTitle } from '../utils/title';

// The track action menu (web TrackContextMenu rethought as a bottom sheet —
// long-press / ⋯ on any row opens it). Base actions in fixed order, each
// omittable per surface; per-surface extras land below a separator. One
// instance mounts in App; rows publish over the trackActionsSheet bus.

// Reads on every theme; the chassis has no dedicated danger token.
const DANGER = '#b3402e';

function Item({ icon, label, danger, onPress }) {
  const { t } = useTheme();
  const color = danger ? DANGER : t.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.item, pressed && styles.pressed]}
    >
      {icon ? (
        <Icon name={icon} size={19} color={danger ? DANGER : t.inkSoft} />
      ) : (
        <View style={styles.iconGap} />
      )}
      <Text style={[styles.itemLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function TrackActionsSheet() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const navRef = useContext(NavigationContainerRefContext);
  const { isLiked, like, unlike } = useLikes();
  const [event, setEvent] = useState(null);

  useEffect(() => subscribeTrackActions(setEvent), []);

  if (!event) {
    return null;
  }
  const { track, omit, extras } = event;
  const liked = isLiked(track.id);

  const act = fn => () => {
    closeTrackActions();
    fn();
  };

  const items = [];
  if (!omit.includes('play')) {
    items.push({
      id: 'play',
      icon: 'play',
      label: 'play song',
      run: () => {
        player.playTrack(track, { source: 'your pick' });
        player.ui?.openPlayer?.();
      },
    });
  }
  if (!omit.includes('playNext')) {
    items.push({
      id: 'playNext',
      icon: 'next',
      label: 'play next',
      run: () => {
        player.enqueueNext(track);
        showToast('queued next.');
      },
    });
  }
  if (!omit.includes('addToQueue')) {
    items.push({
      id: 'addToQueue',
      icon: 'queue-add',
      label: 'add to queue',
      run: () => {
        player.enqueueLast(track);
        showToast('added to queue.');
      },
    });
  }
  if (!omit.includes('addToPlaylist')) {
    items.push({
      id: 'addToPlaylist',
      icon: 'plus',
      label: 'add to playlist',
      run: () => openAddToPlaylist(track),
    });
  }
  if (!omit.includes('like')) {
    items.push({
      id: 'like',
      icon: liked ? 'heart-filled' : 'heart',
      label: liked ? 'unlike' : 'like',
      run: () => {
        showToast(liked ? 'removed from likes.' : 'added to likes.');
        (liked ? unlike(track.id) : like(track.id)).catch(() => {
          showToast("couldn't like — try again.");
        });
      },
    });
  }
  if (!omit.includes('artist') && track.artist) {
    items.push({
      id: 'artist',
      icon: 'user',
      label: 'open artist',
      run: () =>
        navRef?.navigate('Artist', {
          name: track.artist,
          trackId: track.id,
        }),
    });
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View
        entering={FadeIn.duration(DUR.dot).reduceMotion(ReduceMotion.System)}
        exiting={FadeOut.duration(DUR.dot).reduceMotion(ReduceMotion.System)}
        style={[StyleSheet.absoluteFill, styles.backdrop]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="close menu"
          onPress={closeTrackActions}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Animated.View
        entering={SlideInDown.duration(DUR.upNext).reduceMotion(
          ReduceMotion.System,
        )}
        exiting={SlideOutDown.duration(DUR.dot).reduceMotion(
          ReduceMotion.System,
        )}
        style={[
          styles.card,
          {
            backgroundColor: t.surface,
            paddingBottom: insets.bottom + 14,
          },
        ]}
      >
        <View style={[styles.grip, { backgroundColor: t.line }]} />
        <View style={styles.head}>
          <TrackArt track={track} size={44} radius={6} />
          <View style={styles.headMeta}>
            <Text numberOfLines={1} style={[styles.headTitle, { color: t.ink }]}>
              {cleanTitle(track.title)}
            </Text>
            {!!track.artist && (
              <Text
                numberOfLines={1}
                style={[styles.headArtist, { color: t.inkSoft }]}
              >
                {track.artist}
              </Text>
            )}
          </View>
        </View>

        {items.map(item => (
          <Item
            key={item.id}
            icon={item.icon}
            label={item.label}
            onPress={act(item.run)}
          />
        ))}
        {extras.length > 0 && (
          <View style={[styles.separator, { backgroundColor: t.line }]} />
        )}
        {extras.map(extra => (
          <Item
            key={extra.label}
            label={extra.label}
            danger={extra.danger}
            onPress={act(extra.onPress)}
          />
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.45)' },
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  grip: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 10,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 10,
  },
  headMeta: { flex: 1, minWidth: 0, gap: 2 },
  headTitle: { fontFamily: fonts.medium, fontSize: 15 },
  headArtist: { fontFamily: fonts.regular, fontSize: 12.5 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
  },
  pressed: { opacity: 0.6 },
  iconGap: { width: 19 },
  itemLabel: { fontFamily: fonts.medium, fontSize: 15 },
  separator: { height: 1, marginVertical: 6 },
});
