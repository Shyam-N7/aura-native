import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { PressScale } from '../ui/PressScale';
import { Icon } from '../Icon';
import { TrackArt } from '../TrackRow';
import { openTrackActions } from '../../lib/trackActionsSheet';
import { fonts, label, type } from '../../theme/tokens';
import { cleanTitle } from '../../utils/title';
import { fmtTime, fmtRuntime } from '../../utils/fmtTime';

// The shared detail-screen chassis, the native aura-dpd: every entity page
// (liked, artist, album, catalog playlist) is back-crumb + hero + play-all
// pill + count line + numbered 54px-art rows. Screens compose these bits and
// add only what's theirs.

export function CrumbBack({ onPress }) {
  const { t } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="back"
      onPress={onPress}
      hitSlop={10}
      style={styles.back}
    >
      <Icon name="chevron-left" size={24} color={t.ink} />
    </Pressable>
  );
}

export function PlayAllPill({ text, onPress }) {
  const { t } = useTheme();
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={text.toLowerCase()}
      onPress={onPress}
      style={[styles.playAll, { backgroundColor: t.accent }]}
    >
      <View style={[styles.playDisc, { backgroundColor: t.surface }]}>
        <Icon name="play" size={11} color={t.accent} />
      </View>
      <Text style={[styles.playAllText, { color: t.surface }]}>{text}</Text>
    </PressScale>
  );
}

export function CountLine({ tracks, noun = 'track' }) {
  const { t } = useTheme();
  return (
    <Text style={[label(10), styles.count, { color: t.inkFaint }]}>
      {tracks.length} {tracks.length === 1 ? noun : `${noun}s`} ·{' '}
      {fmtRuntime(tracks.reduce((s, x) => s + (x.durationSec || 0), 0))}
    </Text>
  );
}

// Section heading inside a detail scroll (the home SectionHeader carries its
// own page padding; detail screens pad the whole scroll instead).
export function DetailSection({ title, sub }) {
  const { t } = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[type.sectionTitle, { color: t.ink }]}>{title}</Text>
      {!!sub && (
        <Text style={[label(9.5), { color: t.inkFaint }]} numberOfLines={1}>
          {sub}
        </Text>
      )}
    </View>
  );
}

// One numbered track row. `sub` defaults to artist · language; `reason` is
// the auto-mix explainer line; `right` is an optional accessory (heart).
// `menu` ({ omit, extras }) adds the ⋯ button + long-press into the track
// actions sheet — always-visible on native, never hover-gated.
export function DetailRow({ track, index, sub, reason, onPress, right, menu }) {
  const { t } = useTheme();
  const title = cleanTitle(track.title);
  const openMenu = menu ? () => openTrackActions({ track, menu }) : undefined;
  return (
    <View style={styles.row}>
      <Text style={[styles.idx, { color: t.inkFaint }]}>
        {String(index + 1).padStart(2, '0')}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`play ${title}`}
        onPress={onPress}
        onLongPress={openMenu}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
      >
        <TrackArt track={track} size={54} radius={4} />
        <View style={styles.meta}>
          <Text numberOfLines={1} style={[styles.title, { color: t.ink }]}>
            {title}
          </Text>
          <Text numberOfLines={1} style={[label(9.5), { color: t.inkSoft }]}>
            {sub ?? `${(track.artist ?? '').toLowerCase()} · ${track.language ?? ''}`}
          </Text>
          {!!reason && (
            <Text numberOfLines={1} style={[label(8.5), { color: t.inkFaint }]}>
              {reason}
            </Text>
          )}
        </View>
        {!!track.durationSec && (
          <Text style={[type.time, { color: t.inkFaint }]}>
            {fmtTime(track.durationSec)}
          </Text>
        )}
      </Pressable>
      {right}
      {menu && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="more"
          onPress={openMenu}
          hitSlop={8}
          style={({ pressed }) => [styles.more, pressed && styles.pressed]}
        >
          <Icon name="dots" size={17} color={t.inkFaint} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  back: { alignSelf: 'flex-start', paddingVertical: 4, marginLeft: -4 },
  playAll: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 9,
    borderRadius: 999,
    paddingLeft: 7,
    paddingRight: 18,
    paddingVertical: 7,
    marginTop: 10,
  },
  playDisc: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 2,
  },
  playAllText: { fontFamily: fonts.medium, fontSize: 14 },
  count: { marginTop: 10 },
  section: { gap: 3, marginTop: 26, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
  },
  pressed: { opacity: 0.6 },
  idx: {
    width: 22,
    fontSize: 11,
    textAlign: 'center',
    fontFamily: fonts.regular,
    fontVariant: ['tabular-nums'],
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  meta: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontFamily: fonts.medium, fontSize: 15 },
  more: { paddingVertical: 8, paddingLeft: 2 },
});
