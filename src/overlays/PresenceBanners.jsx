import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeInUp,
  FadeOutUp,
  ReduceMotion,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { usePlaybackProgress } from '../hooks/usePlaybackProgress';
import { usePlaybackPresence } from '../hooks/usePlaybackPresence';
import { getResume } from '../api/playback';
import { getTrack } from '../api/catalog';
import { storage } from '../storage/mmkv';
import { Icon } from '../components/Icon';
import { fonts, radii } from '../theme/tokens';
import { DUR } from '../theme/motion';
import { cleanTitle } from '../utils/title';

// Multi-device awareness, ported from web App.jsx + NowPlayingElsewhere:
// a passive "Playing X on <device>" note when another of the user's devices
// is playing (no takeover, no remote control), and a one-shot cross-device
// resume offer on boot. Heartbeats ride along via usePlaybackPresence.

function readSavedTrackId() {
  try {
    const raw = storage.getItem('aura.position');
    return raw ? JSON.parse(raw)?.trackId ?? null : null;
  } catch {
    return null;
  }
}

export function PresenceBanners() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  // Slow ticker — presence only needs a fraction per 20s beat.
  const { progress } = usePlaybackProgress(5000);
  const others = usePlaybackPresence({
    track: player.current,
    playing: player.isPlaying,
    progress,
  });

  // Dismissal is per device+track (component state, web parity): a new song
  // on the same device re-surfaces the note.
  const [dismissed, setDismissed] = useState(null);
  const [resume, setResume] = useState(null);
  const bootTrackId = useRef(player.current?.id);

  useEffect(() => {
    getResume().then(r => {
      if (!r?.track?.id) {
        return;
      }
      // Offer only mid-track playback that isn't already where we are.
      if (r.progress <= 0.02 || r.progress >= 0.98) {
        return;
      }
      if (
        r.track.id === readSavedTrackId() ||
        r.track.id === bootTrackId.current
      ) {
        return;
      }
      setResume(r);
    });
  }, []);

  const acceptResume = async () => {
    const r = resume;
    setResume(null);
    // Refetch for a fresh streamUrl + durationSec; the resume row carries
    // only display fields.
    const fresh = await getTrack(r.track.id).catch(() => null);
    const track = fresh ?? r.track;
    player.playTrack(track, { source: 'your pick' });
    if (track.durationSec) {
      // Rides the op chain, so it lands after the load + play.
      player.seekTo(r.progress * track.durationSec);
    }
    player.ui?.openPlayer?.();
  };

  const device = others[0] ?? null;
  const npeKey = device ? `${device.deviceLabel}|${device.track?.id}` : null;
  const showNpe = device && npeKey !== dismissed;

  if (!showNpe && !resume) {
    return null;
  }

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insets.top + 8 }]}
    >
      {showNpe && (
        <Animated.View
          entering={FadeInUp.duration(DUR.toastIn).reduceMotion(
            ReduceMotion.System,
          )}
          exiting={FadeOutUp.duration(DUR.dot).reduceMotion(
            ReduceMotion.System,
          )}
          style={[
            styles.pill,
            { backgroundColor: t.surface, borderColor: t.line },
          ]}
        >
          <View style={[styles.dot, { backgroundColor: t.accent }]} />
          <Text numberOfLines={1} style={[styles.text, { color: t.ink }]}>
            Playing{' '}
            {device.track?.title
              ? `"${cleanTitle(device.track.title)}" `
              : ''}
            on {device.deviceLabel || 'another device'}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="dismiss now playing elsewhere"
            onPress={() => setDismissed(npeKey)}
            hitSlop={10}
          >
            <Icon name="close" size={13} color={t.inkFaint} />
          </Pressable>
        </Animated.View>
      )}
      {resume && (
        <Animated.View
          entering={FadeInUp.duration(DUR.toastIn).reduceMotion(
            ReduceMotion.System,
          )}
          exiting={FadeOutUp.duration(DUR.dot).reduceMotion(
            ReduceMotion.System,
          )}
          style={[
            styles.pill,
            { backgroundColor: t.surface, borderColor: t.line },
          ]}
        >
          <Text numberOfLines={1} style={[styles.text, { color: t.ink }]}>
            Pick up "{cleanTitle(resume.track.title)}" from your other device?
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="resume"
            onPress={acceptResume}
            hitSlop={8}
          >
            <Text style={[styles.action, { color: t.accent }]}>Resume</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="dismiss resume"
            onPress={() => setResume(null)}
            hitSlop={10}
          >
            <Icon name="close" size={13} color={t.inkFaint} />
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 8,
    zIndex: 60,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    maxWidth: '92%',
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  text: { fontFamily: fonts.regular, fontSize: 12.5, flexShrink: 1 },
  action: { fontFamily: fonts.medium, fontSize: 13 },
});
