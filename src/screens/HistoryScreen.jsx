import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { getHistory, getMusicClockPlays } from '../api/stats';
import { summarizeClock } from '../lib/musicClock';
import { openTrackActions } from '../lib/trackActionsSheet';
import { TrackArt } from '../components/TrackRow';
import { CrumbBack } from '../components/detail/DetailChassis';
import { fonts, label, type } from '../theme/tokens';
import { cleanTitle } from '../utils/title';
import { formatTime12 } from '../utils/daypart';

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
      <Text style={[label(10), { color: t.inkFaint }]}>your music clock</Text>
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
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const [plays, setPlays] = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [clock, setClock] = useState(null);
  const [status, setStatus] = useState('loading');
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const ctl = new AbortController();
    Promise.all([
      getHistory({ limit: 80, signal: ctl.signal }),
      getMusicClockPlays({ signal: ctl.signal }).catch(() => []),
    ])
      .then(([h, clockPlays]) => {
        setPlays(h.plays);
        setNextBefore(h.nextBefore);
        setClock(summarizeClock(clockPlays, { perPart: 2 }));
        setStatus('ok');
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          setStatus('error');
        }
      });
    return () => ctl.abort();
  }, []);

  const loadMore = () => {
    if (!nextBefore || loadingMore) {
      return;
    }
    setLoadingMore(true);
    getHistory({ limit: 80, before: nextBefore })
      .then(h => {
        setPlays(prev => [...prev, ...h.plays]);
        setNextBefore(h.nextBefore);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

  const days = useMemo(() => groupPlaysByDay(plays), [plays]);

  const pickLive = track => {
    player.playTrack(track, { source: 'your pick' });
    player.ui?.openPlayer?.();
  };

  const header = (
    <View style={styles.header}>
      <CrumbBack onPress={() => navigation.goBack()} />
      <Text style={[type.queueHero, { color: t.ink }]}>your history.</Text>
      {status === 'loading' && (
        <Text style={[styles.stateLine, { color: t.inkFaint }]}>
          Loading history
        </Text>
      )}
      {status === 'error' && (
        <Text style={[styles.stateLine, { color: t.inkSoft }]}>
          Couldn't load your history.
        </Text>
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
          {loadingMore ? 'Loading…' : 'Load more'}
        </Text>
      </Pressable>
    ) : null;

  const renderItem = ({ item }) => {
    const title = cleanTitle(item.title);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`play ${title}`}
        onPress={() => pickLive(item)}
        onLongPress={() => openTrackActions({ track: item, menu: {} })}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <TrackArt track={item} size={50} radius={4} />
        <View style={styles.meta}>
          <Text numberOfLines={1} style={[styles.title, { color: t.ink }]}>
            {title}
          </Text>
          <Text numberOfLines={1} style={[label(9.5), { color: t.inkSoft }]}>
            {(item.artist ?? '').toLowerCase()} · {item.language ?? ''}
          </Text>
        </View>
        <Text style={[type.time, { color: t.inkFaint }]}>
          {formatTime12(new Date(item.playedAt))}
        </Text>
      </Pressable>
    );
  };

  return (
    <View
      style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}
    >
      <SectionList overScrollMode="always"
        sections={status === 'ok' ? days : []}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => (
          <Text style={[label(10), styles.dayHead, { color: t.inkFaint }]}>
            {section.heading}
          </Text>
        )}
        keyExtractor={item => `${item.id}-${item.playedAt}`}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 24 },
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
  stateLine: { fontFamily: fonts.regular, fontSize: 13.5 },
  empty: { marginTop: 10, gap: 5 },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 17 },
  emptyBody: { fontFamily: fonts.regular, fontSize: 13.5 },
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 7,
  },
  pressed: { opacity: 0.6 },
  meta: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontFamily: fonts.medium, fontSize: 15 },
  more: {
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 10,
    marginTop: 18,
  },
});
