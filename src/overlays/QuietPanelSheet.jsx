import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { subscribePresenceFeed } from '../lib/presenceFeed';
import { closeQuietPanel, subscribeQuietPanel } from '../lib/quietPanel';
import { getNotifications, markNotificationsSeen } from '../api/notifications';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/ui/Sheet';
import { TrackArt } from '../components/TrackRow';
import { fonts, label } from '../theme/tokens';
import { cleanTitle } from '../utils/title';

// The quiet panel (owner's brief: "nothing visits you — you visit it").
// Cross-device presence rides on top as live state; beneath it, the recorded
// feed the server keeps alongside pushes (mixes ready, shared-playlist
// activity, app notes). Everything is marked seen on open — the bell's dot is
// the entire attention mechanism.

// "2h ago" register, coarse on purpose — the panel is a quiet place.
function ago(ts) {
  const m = Math.max(1, Math.round((Date.now() - ts) / 60_000));
  if (m < 60) {
    return `${m}m ago`;
  }
  const h = Math.round(m / 60);
  if (h < 24) {
    return `${h}h ago`;
  }
  return `${Math.round(h / 24)}d ago`;
}

export function QuietPanelSheet() {
  const { t } = useTheme();
  const [open, setOpen] = useState(false);
  const [feed, setFeed] = useState({
    elsewhere: null,
    resume: null,
    acceptResume: null,
    dismissResume: null,
  });
  const [rows, setRows] = useState([]);

  useEffect(() => subscribeQuietPanel(setOpen), []);
  useEffect(() => subscribePresenceFeed(setFeed), []);

  // Fetch on every open, but show ONLY what hasn't been seen — a row you've
  // read is cleared and never comes back (owner's call). Seen is marked after
  // this read renders, so the batch is visible once and gone the next open.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    let alive = true;
    getNotifications().then(list => {
      if (alive) {
        setRows(list.filter(n => !n.seenAt));
        markNotificationsSeen();
      }
    });
    return () => {
      alive = false;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const pickUp = () => {
    closeQuietPanel();
    feed.acceptResume?.();
  };

  const quiet = !feed.resume && !feed.elsewhere && rows.length === 0;

  return (
    <Sheet onClose={closeQuietPanel} closeLabel="close notifications">
      <Text style={[styles.title, { color: t.ink }]}>for you</Text>
      {quiet && (
        <Text style={[styles.empty, { color: t.inkSoft }]}>
          quiet for now.
        </Text>
      )}
      {feed.resume && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="pick up from your other device"
          onPress={pickUp}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <TrackArt track={feed.resume.track} size={38} radius={8} />
          <View style={styles.rowMeta}>
            <Text
              numberOfLines={1}
              style={[styles.rowLabel, { color: t.ink }]}
            >
              pick up "{cleanTitle(feed.resume.track.title)}"
            </Text>
            <Text style={[styles.rowHint, { color: t.inkSoft }]}>
              from your other device, tap to resume
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="dismiss pick up"
            onPress={feed.dismissResume}
            hitSlop={12}
          >
            <Icon name="close" size={14} color={t.inkFaint} />
          </Pressable>
        </Pressable>
      )}
      {feed.elsewhere?.track && (
        <View style={styles.row}>
          <TrackArt track={feed.elsewhere.track} size={38} radius={8} />
          <View style={styles.rowMeta}>
            <Text
              numberOfLines={1}
              style={[styles.rowLabel, { color: t.ink }]}
            >
              playing "{cleanTitle(feed.elsewhere.track.title)}"
            </Text>
            <Text style={[styles.rowHint, { color: t.inkSoft }]}>
              on {feed.elsewhere.deviceLabel || 'another device'}
            </Text>
          </View>
          <View style={[styles.liveDot, { backgroundColor: t.accent }]} />
        </View>
      )}
      {rows.map(n => (
        <View key={n.id} style={styles.row}>
          <View style={styles.rowMeta}>
            <Text numberOfLines={1} style={[styles.rowLabel, { color: t.ink }]}>
              {n.payload?.title}
            </Text>
            {!!n.payload?.body && (
              <Text
                numberOfLines={2}
                style={[styles.rowHint, { color: t.inkSoft }]}
              >
                {n.payload.body}
              </Text>
            )}
            <Text style={[label(8.5), { color: t.inkFaint }]}>
              {ago(n.createdAt)}
            </Text>
          </View>
          <View style={[styles.liveDot, { backgroundColor: t.accent }]} />
        </View>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.semibold, fontSize: 18, marginBottom: 6 },
  empty: { fontFamily: fonts.regular, fontSize: 13.5, paddingVertical: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
  },
  pressed: { opacity: 0.6 },
  rowMeta: { flex: 1, gap: 2 },
  rowLabel: { fontFamily: fonts.medium, fontSize: 15 },
  rowHint: { fontFamily: fonts.regular, fontSize: 12.5 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
});
