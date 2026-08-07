import React from 'react';
import { PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { PressScale } from '../ui/PressScale';
import { Icon } from '../Icon';
import { TrackArt } from '../TrackRow';
import { openTrackActions } from '../../lib/trackActionsSheet';
import { splitMatch } from '../../lib/listFilter';
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

// The row's geometry, in one place, because getItemLayout below promises it to
// the virtualizer and a drifted padding would be a VISIBLE bug — overlapping or
// gapped rows — not a slow one. The art dominates the row: the meta column runs
// to about 50px with all three lines, under the 54 the thumb occupies.
const ROW_ART = 54;
const ROW_PAD_V = 7;
export const DETAIL_ROW_H = ROW_ART + ROW_PAD_V * 2;

// Every one of these lists measures each cell through onLayout, and at
// windowSize 3 (lib/listWindow) the virtualizer cannot place the next cell
// until the previous one reports back — which is what a fling into blank rows
// actually is. getItemLayout removes the round trip.
//
// Gated on the font scale, and this is the whole reason it is conditional:
// nothing in this app sets allowFontScaling or maxFontSizeMultiplier, so an
// enlarged system font grows the meta column past the art and the row with it.
// A constant that lies to the virtualizer is worse than no constant. Large-font
// users keep exactly today's behaviour — measured rows, no pinned height.
const FIXED_ROWS = PixelRatio.getFontScale() === 1;

export const DETAIL_ITEM_LAYOUT = FIXED_ROWS
  ? (_data, index) => ({
      length: DETAIL_ROW_H,
      offset: DETAIL_ROW_H * index,
      index,
    })
  : undefined;

// label() builds a NEW style object every time it is called, and these two sat
// inline in the row body — so a 200-row list allocated 400 of them per render.
// Hoisted: the values are constant, only the colour varies and that is already
// a separate object in the style array.
const ROW_SUB = label(9.5);
const ROW_REASON = label(8.5);

// One numbered track row. `sub` defaults to artist · language; `reason` is
// the auto-mix explainer line; `right` is an optional accessory (heart);
// `highlight` tints the in-list search match inside the title.
// `menu` ({ omit, extras }) adds the ⋯ button + long-press into the track
// actions sheet — always-visible on native, never hover-gated.
function DetailRowBase({
  track,
  index,
  sub,
  reason,
  onPress,
  right,
  menu,
  highlight,
}) {
  const { t } = useTheme();
  const title = cleanTitle(track.title);
  const openMenu = menu ? () => openTrackActions({ track, menu }) : undefined;
  return (
    // Pinned when getItemLayout is live, so the promised height is true by
    // construction rather than by arithmetic that can drift.
    <View style={FIXED_ROWS ? styles.rowFixed : styles.row}>
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
        <TrackArt track={track} size={ROW_ART} radius={4} />
        <View style={styles.meta}>
          <Text numberOfLines={1} style={[styles.title, { color: t.ink }]}>
            {highlight
              ? splitMatch(title, highlight).map((p, i) =>
                  p.hit ? (
                    <Text key={i} style={{ color: t.accent }}>
                      {p.text}
                    </Text>
                  ) : (
                    p.text
                  ),
                )
              : title}
          </Text>
          <Text numberOfLines={1} style={[ROW_SUB, { color: t.inkSoft }]}>
            {sub ?? `${(track.artist ?? '').toLowerCase()} · ${track.language ?? ''}`}
          </Text>
          {!!reason && (
            <Text numberOfLines={1} style={[ROW_REASON, { color: t.inkFaint }]}>
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

// Memoized so a screen re-render does not re-render every mounted row.
//
// This only earns anything when the CALLER hands stable props — an inline
// `onPress={() => …}`, a `menu={{…}}` literal or a `right={<X/>}` element
// defeats the shallow compare on its own. All four callers now wrap their row
// in a memoized component that builds those itself; __tests__/listRowStability
// locks that, because wrapping first and stabilising later reads as a fix while
// changing nothing, which is exactly what happened here once.
export const DetailRow = React.memo(DetailRowBase);

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
    paddingVertical: ROW_PAD_V,
  },
  rowFixed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: ROW_PAD_V,
    height: DETAIL_ROW_H,
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
