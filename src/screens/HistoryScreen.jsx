import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BounceSectionList } from '../components/ui/Bounce';
import { ROW_LAYOUT } from '../components/ui/RowArrive';
import { DOCK_CLEARANCE } from '../components/nav/Dock';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { getHistory, getMusicClockPlays } from '../api/stats';
import { summarizeClock } from '../lib/musicClock';
import { openTrackActions } from '../lib/trackActionsSheet';
import { LONG_LIST } from '../lib/listWindow';
import { TrackArt } from '../components/TrackRow';
import { Icon } from '../components/Icon';
import { CrumbBack } from '../components/detail/DetailChassis';
import { AuraLoader } from '../components/ui/AuraLoader';
import { ErrorState } from '../components/ui/ErrorState';
import { fonts, label, radii, type } from '../theme/tokens';
import { cleanTitle } from '../utils/title';
import { formatTime12 } from '../utils/daypart';
import { useBackToTop } from '../hooks/useBackToTop';
import { usePullRefresh } from '../hooks/usePullRefresh';
import { countRender } from '../lib/renderCount';

// Nothing inline reaches a row. This screen does not use DetailRow, so none of
// the row work done on liked/album/playlist reached it — its row was an
// anonymous Pressable inside an inline renderItem, unmemoized, allocating two
// closures, a style function, three style arrays, three colour objects, a
// menu literal, a label() call and a Date, per row, per render. And every
// wrapper around it (renderItem, renderSectionHeader, the header and footer
// ELEMENTS) took a fresh identity every render, so every mounted cell
// re-rendered regardless of whether its play had changed.
//
// label() builds a new style object per call, so these are hoisted the same way
// DetailChassis hoists ROW_SUB.
const ROW_MENU = {};
const ROW_SUB = label(9.5);
const DAY_HEAD = label(10);

const HistoryRow = React.memo(function HistoryRow({
  play,
  onPlay,
  ink,
  inkSoft,
  inkFaint,
}) {
  const title = cleanTitle(play.title);
  const press = useCallback(() => onPlay(play), [onPlay, play]);
  const hold = useCallback(
    () => openTrackActions({ track: play, menu: ROW_MENU }),
    [play],
  );
  return (
    <View style={styles.rowWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`play ${title}`}
        onPress={press}
        onLongPress={hold}
        style={pressStyle}
      >
        <TrackArt track={play} size={50} radius={4} />
        <View style={styles.meta}>
          <Text numberOfLines={1} style={[styles.title, { color: ink }]}>
            {title}
          </Text>
          <Text numberOfLines={1} style={[ROW_SUB, { color: inkSoft }]}>
            {(play.artist ?? '').toLowerCase()} · {play.language ?? ''}
          </Text>
        </View>
        <Text style={[type.time, { color: inkFaint }]}>
          {formatTime12(new Date(play.playedAt))}
        </Text>
      </Pressable>
      {/* The hold that opens the track actions, made visible — the same ⋯
          TrackRow wears, so the two row shapes stay one control. Without it
          this row's menu existed only as a gesture nothing announced. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="more"
        onPress={hold}
        hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
        style={morePressStyle}
      >
        <Icon name="dots" size={17} color={inkFaint} />
      </Pressable>
    </View>
  );
});

// Pressable's style-as-function, defined once rather than per row per render.
const pressStyle = ({ pressed }) => [styles.row, pressed && styles.pressed];
const morePressStyle = ({ pressed }) => [
  styles.rowMore,
  pressed && styles.pressed,
];

// Closes over nothing, so it belongs here rather than being rebuilt per render.
const keyForPlay = play => `${play.id}-${play.playedAt}`;

// Full listening history, ported from web DesktopHistory: the time-of-day
// "music clock" insight on top, then every play grouped by local day, newest
// first, with cursor-paginated load-more. Rows are one PER PLAY (duplicates
// of the same track are expected) — keys carry playedAt.

const dateKeyLocal = ts => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

function dayHeading(ts, todayKey, yesterdayKey) {
  const key = dateKeyLocal(ts);
  if (key === todayKey) {
    return 'Today';
  }
  if (key === yesterdayKey) {
    return 'Yesterday';
  }
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

// Walk newest-first plays once into contiguous local-day groups (SectionList
// sections). Pure, exported for tests.
export function groupPlaysByDay(plays, now = new Date()) {
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const yd = new Date(now);
  yd.setDate(now.getDate() - 1);
  const yesterdayKey = `${yd.getFullYear()}-${yd.getMonth()}-${yd.getDate()}`;
  const out = [];
  let cur = null;
  for (const p of plays) {
    const key = dateKeyLocal(p.playedAt);
    if (!cur || cur.key !== key) {
      cur = {
        key,
        heading: dayHeading(p.playedAt, todayKey, yesterdayKey),
        data: [],
      };
      out.push(cur);
    }
    cur.data.push(p);
  }
  return out;
}

// The time-of-day insight, derived entirely client-side (local time) from the
// windowed clock plays. Segment weights = play counts (0.04 floor keeps empty
// parts visible); segment shades = the accent at rising opacity through the day.
const SEG_OPACITY = { morning: 0.4, afternoon: 0.62, evening: 0.82, night: 1 };

function MusicClock({ clock }) {
  const { t } = useTheme();
  return (
    <View style={[styles.clock, { backgroundColor: t.surface }]}>
      <Text style={[label(10), { color: t.inkFaint }]}>Your music clock</Text>
      <Text style={[styles.clockSub, { color: t.inkSoft }]}>
        What you play most at each time of day.
      </Text>

      <View style={styles.clockBar}>
        {clock.parts.map(p => (
          <View
            key={p.key}
            style={{
              flexGrow: p.plays || 0.04,
              backgroundColor: t.accent,
              opacity: SEG_OPACITY[p.key],
            }}
          />
        ))}
      </View>

      <View style={styles.clockParts}>
        {clock.parts.map(p => (
          <View key={p.key} style={styles.clockPart}>
            <View style={styles.clockPartHead}>
              <Text style={[label(9), { color: t.ink }]}>{p.label}</Text>
              <Text style={[label(9), { color: t.inkFaint }]}>{p.plays}</Text>
            </View>
            {p.topTracks.length ? (
              p.topTracks.map(x => (
                <Text
                  key={x.trackId}
                  numberOfLines={1}
                  style={[styles.clockTrack, { color: t.inkSoft }]}
                >
                  {cleanTitle(x.title)}
                </Text>
              ))
            ) : (
              <Text style={[styles.clockTrack, { color: t.inkFaint }]}>—</Text>
            )}
          </View>
        ))}
      </View>

      {(clock.afterMidnight || clock.busiest) && (
        <Text style={[styles.clockHeadline, { color: t.ink }]}>
          {clock.afterMidnight ? (
            <>
              <Text style={{ color: t.accent }}>
                {cleanTitle(clock.afterMidnight.title)}
              </Text>
              {' is your most-played after midnight.'}
            </>
          ) : (
            <>
              {'You listen most in the '}
              <Text style={{ color: t.accent }}>{clock.busiest.label}</Text>.
            </>
          )}
        </Text>
      )}
    </View>
  );
}

export default function HistoryScreen({ navigation }) {
  // __DEV__-only; stripped from release (lib/renderCount).
  countRender('HistoryScreen');
  const backToTop = useBackToTop();
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const [plays, setPlays] = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [clock, setClock] = useState(null);
  const [status, setStatus] = useState('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  // A failed page used to be swallowed: the spinner blinked, no rows arrived,
  // and the screen read as "that's all my history" (or as a dead button).
  const [moreError, setMoreError] = useState(false);

  // Page one, lifted out of the effect so the error state can offer the same
  // retry the load-more control does. A first-page failure used to be a dead
  // end — one line of copy and no way back — while page two got a button.
  //
  // `quiet` is the pull-to-refresh mode of the same request: no blank-to-
  // loading on the way in, and a failure re-thrown instead of written into
  // the error state, so the history already on screen survives it.
  //
  // Refreshing a CURSOR-paginated list means page one and nothing else, and
  // that is deliberate rather than lossy: pages after the first are windows
  // behind a `before` cursor, so keeping them while page one is replaced
  // would leave a hole wherever plays landed in between — and `nextBefore`
  // would no longer describe the list under it. Page one plus the cursor that
  // belongs to it is the only self-consistent answer; Load more walks down
  // again from there.
  const loadFirstPage = useCallback((signal, { quiet = false } = {}) => {
    if (!quiet) {
      setStatus('loading');
    }
    return Promise.all([
      getHistory({ limit: 80, signal }),
      getMusicClockPlays({ signal }).catch(() => []),
    ])
      .then(([h, clockPlays]) => {
        setPlays(h.plays);
        setNextBefore(h.nextBefore);
        setClock(summarizeClock(clockPlays, { perPart: 2 }));
        setMoreError(false);
        setStatus('ok');
      })
      .catch(err => {
        if (err.name === 'AbortError') {
          return;
        }
        if (quiet) {
          throw err;
        }
        setStatus('error');
      });
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    loadFirstPage(ctl.signal);
    return () => ctl.abort();
  }, [loadFirstPage]);

  // Pull-to-refresh: page one again. See ui/Bounce for how the pull and the
  // rubber band share one downward drag at the top.
  const pull = usePullRefresh(signal => loadFirstPage(signal, { quiet: true }));

  const loadMore = () => {
    if (!nextBefore || loadingMore) {
      return;
    }
    setLoadingMore(true);
    setMoreError(false);
    getHistory({ limit: 80, before: nextBefore })
      .then(h => {
        setPlays(prev => [...prev, ...h.plays]);
        setNextBefore(h.nextBefore);
      })
      .catch(() => setMoreError(true))
      .finally(() => setLoadingMore(false));
  };

  const days = useMemo(() => groupPlaysByDay(plays), [plays]);

  // playerRef, not a `player` dep: the context value takes a new identity on
  // every track advance and every play/pause, and this only runs on a tap — so
  // depending on it would hand every mounted row a new onPlay while a song
  // simply plays, which is what the memo above exists to prevent.
  const playerRef = useRef(player);
  playerRef.current = player;
  const pickLive = useCallback(track => {
    playerRef.current.playTrack(track, { source: 'your pick' });
    playerRef.current.ui?.openPlayer?.();
  }, []);

  const header = (
    <View style={styles.header}>
      <CrumbBack onPress={() => navigation.goBack()} />
      <Text style={[type.queueHero, { color: t.ink }]}>Your history.</Text>
      {status === 'loading' && <AuraLoader label="Loading history" />}
      {/* The pill this screen grew for its own first-page failure is now the
          shared ErrorState every other screen wears — same markup, same
          spacing, same hitSlop. */}
      {status === 'error' && (
        <ErrorState
          message="Couldn't load your history."
          onRetry={() => loadFirstPage()}
        />
      )}
      {status === 'ok' && plays.length === 0 && (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: t.ink }]}>
            Nothing played yet.
          </Text>
          <Text style={[styles.emptyBody, { color: t.inkSoft }]}>
            Your history fills in as you listen.
          </Text>
        </View>
      )}
      {status === 'ok' && clock?.totalPlays > 0 && <MusicClock clock={clock} />}
    </View>
  );

  const footer =
    status === 'ok' && nextBefore ? (
      <>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="load more"
          onPress={loadMore}
          style={({ pressed }) => [
            styles.more,
            { borderColor: t.line },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[label(10), { color: t.inkSoft }]}>
            {loadingMore ? 'Loading…' : moreError ? 'Try again' : 'Load more'}
          </Text>
        </Pressable>
        {moreError && (
          <Text
            style={[styles.stateLine, styles.moreError, { color: t.inkSoft }]}
          >
            Couldn't load more.
          </Text>
        )}
      </>
    ) : null;

  const renderItem = useCallback(
    ({ item }) => (
      <HistoryRow
        play={item}
        onPlay={pickLive}
        ink={t.ink}
        inkSoft={t.inkSoft}
        inkFaint={t.inkFaint}
      />
    ),
    [pickLive, t.ink, t.inkSoft, t.inkFaint],
  );

  const renderSectionHeader = useCallback(
    ({ section }) => (
      <Text style={[DAY_HEAD, styles.dayHead, { color: t.inkFaint }]}>
        {section.heading}
      </Text>
    ),
    [t.inkFaint],
  );

  return (
    <View
      style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}
    >
      <BounceSectionList
        {...backToTop}
        sections={status === 'ok' ? days : []}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        keyExtractor={keyForPlay}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        stickySectionHeadersEnabled={false}
        // Load-more appends a page onto the same list rather than replacing
        // it, so the rows already on screen settle instead of jumping when the
        // next 80 plays land. (No arrive animation: the appended page is
        // requested, not streamed — it is already where the user is looking.)
        itemLayoutAnimation={ROW_LAYOUT}
        refreshControl={pull.control}
        {...LONG_LIST}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + DOCK_CLEARANCE },
        ]}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { paddingHorizontal: 20 },
  header: { paddingTop: 10, paddingBottom: 6, gap: 10 },
  stateLine: type.caption,
  empty: { marginTop: 10, gap: 5 },
  emptyTitle: type.blockTitle,
  emptyBody: type.caption,
  clock: {
    borderRadius: 16,
    padding: 16,
    gap: 10,
    marginTop: 4,
  },
  clockSub: { fontFamily: fonts.regular, fontSize: 13, marginTop: -4 },
  clockBar: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    gap: 2,
  },
  clockParts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 12,
  },
  clockPart: { flexBasis: '50%', paddingRight: 10, gap: 3 },
  clockPartHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  clockTrack: { fontFamily: fonts.regular, fontSize: 12 },
  clockHeadline: {
    fontFamily: fonts.medium,
    fontSize: 14.5,
    lineHeight: 20,
    marginTop: 2,
  },
  dayHead: { paddingTop: 16, paddingBottom: 6 },
  rowWrap: { flexDirection: 'row', alignItems: 'center' },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 7,
  },
  // TrackRow's ⋯ box, to the pixel.
  rowMore: { paddingVertical: 10, paddingLeft: 8 },
  pressed: { opacity: 0.6 },
  meta: { flex: 1, minWidth: 0, gap: 3 },
  title: type.rowTitle,
  more: {
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 22,
    paddingVertical: 10,
    marginTop: 18,
  },
  moreError: { textAlign: 'center', marginTop: 8 },
});
