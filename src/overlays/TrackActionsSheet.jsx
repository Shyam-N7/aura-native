import React, { useContext, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { NavigationContainerRefContext } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { getSeedRadio } from '../api/autoPlaylists';
import { useLikes } from '../hooks/useLikes';
import {
  closeTrackActions,
  subscribeTrackActions,
} from '../lib/trackActionsSheet';
import { openAddToPlaylist } from '../lib/addToPlaylistSheet';
import { openWhy } from '../lib/whySheet';
import { shareTrack } from '../lib/share';
import { showToast } from '../lib/toast';
import { TrackArt } from '../components/TrackRow';
import { Sheet } from '../components/ui/Sheet';
import { SheetRow } from '../components/ui/SheetRow';
import { fonts } from '../theme/tokens';
import { cleanTitle } from '../utils/title';

// The track action menu (web TrackContextMenu rethought as a bottom sheet —
// long-press / ⋯ on any row opens it). Base actions in fixed order, each
// omittable per surface; per-surface extras land below a separator. One
// instance mounts in App; rows publish over the trackActionsSheet bus.

export function TrackActionsSheet() {
  const { t } = useTheme();
  const player = usePlayer();
  const navRef = useContext(NavigationContainerRefContext);
  const { isLiked, like, unlike } = useLikes();
  const [event, setEvent] = useState(null);

  useEffect(() => subscribeTrackActions(setEvent), []);

  // A malformed event (a caller that forgot to wrap the track) must never take
  // the whole app down — just don't open.
  if (!event?.track) {
    return null;
  }
  const { track, omit, extras, play } = event;
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
      label: 'Play song',
      run:
        play ??
        (() => {
          player.playTrack(track, { source: 'your pick' });
          player.ui?.openPlayer?.();
        }),
    });
  }
  if (!omit.includes('radio')) {
    items.push({
      id: 'radio',
      icon: 'wave',
      label: 'Start AURA radio',
      // Our radio, not YouTube's weather: seed station + similarity graph,
      // served as a ready queue (see server/seedMix.js for the verdict).
      run: () => {
        getSeedRadio(track.id)
          .then(mix => {
            if (!mix?.tracks?.length) {
              showToast('Not enough nearby songs yet — play it a little first.');
              return;
            }
            player.playQueue(mix.tracks, 0, mix.name);
            player.ui?.openPlayer?.();
          })
          .catch(() => showToast("Couldn't start the radio."));
      },
    });
  }
  if (!omit.includes('playNext')) {
    items.push({
      id: 'playNext',
      icon: 'next',
      label: 'Play next',
      run: () => {
        player.enqueueNext(track);
        showToast('Queued next.');
      },
    });
  }
  if (!omit.includes('addToQueue')) {
    items.push({
      id: 'addToQueue',
      icon: 'queue-add',
      label: 'Add to queue',
      run: () => {
        player.enqueueLast(track);
        showToast('Added to queue.');
      },
    });
  }
  if (!omit.includes('addToPlaylist')) {
    items.push({
      id: 'addToPlaylist',
      icon: 'plus',
      label: 'Add to playlist',
      run: () => openAddToPlaylist(track),
    });
  }
  if (!omit.includes('like')) {
    items.push({
      id: 'like',
      icon: liked ? 'heart-filled' : 'heart',
      label: liked ? 'Unlike' : 'Like',
      run: () => {
        showToast(liked ? 'Removed from likes.' : 'Added to likes.');
        (liked ? unlike(track.id) : like(track.id)).catch(() => {
          showToast("Couldn't like — try again.");
        });
      },
    });
  }
  if (!omit.includes('share')) {
    items.push({
      id: 'share',
      icon: 'share',
      label: 'Share song',
      run: () => shareTrack(track),
    });
  }
  if (!omit.includes('why')) {
    items.push({
      id: 'why',
      icon: 'bloom',
      label: 'Why this song',
      run: () => openWhy(track),
    });
  }
  if (!omit.includes('artist') && track.artist) {
    items.push({
      id: 'artist',
      icon: 'user',
      label: 'Open artist',
      // The artist screen lives in the navigator UNDER the player/queue
      // overlays — fold those away or the navigation happens invisibly.
      run: () => {
        player.ui?.closeQueue?.();
        player.ui?.closePlayer?.();
        navRef?.navigate('Artist', {
          name: track.artist,
          trackId: track.id,
        });
      },
    });
  }

  return (
    <Sheet onClose={closeTrackActions} closeLabel="close menu">
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
        <SheetRow
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
        <SheetRow
          key={extra.label}
          icon={extra.icon}
          label={extra.label}
          danger={extra.danger}
          onPress={act(extra.onPress)}
        />
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 10,
  },
  headMeta: { flex: 1, minWidth: 0, gap: 2 },
  headTitle: { fontFamily: fonts.medium, fontSize: 15 },
  headArtist: { fontFamily: fonts.regular, fontSize: 12.5 },
  separator: { height: 1, marginVertical: 6 },
});
