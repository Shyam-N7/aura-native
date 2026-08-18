import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { getJournal } from '../api/journal';
import { getTrack } from '../api/catalog';
import { cleanTitle } from '../utils/title';
import { TrackArt } from '../components/TrackRow';
import { Icon } from '../components/Icon';
import { BounceScrollView } from '../components/ui/Bounce';
import { AuraLoader } from '../components/ui/AuraLoader';
import { PressScale } from '../components/ui/PressScale';
import { ScreenFade } from '../components/ui/ScreenFade';
import { fonts, label } from '../theme/tokens';

// Ported from web DesktopJournal.jsx: the private listening journal — one
// auto-written entry per listening day. The web renders entry.tracks as track
// objects but the server sends ID strings (so its thumbnails silently never
// show); here the ids are hydrated into real tracks, best-effort and capped.

const THUMBS_PER_ENTRY = 4;
const HYDRATE_CAP = 16;

export default function JournalScreen({ navigation }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const [hit, setHit] = useState({ data: null, error: null });
  const [thumbs, setThumbs] = useState({}); // trackId -> track object

  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';

  useEffect(() => {
    const ctl = new AbortController();
    getJournal({ days: 7, signal: ctl.signal })
      .then(data => setHit({ data, error: null }))
      .catch(err => {
        if (err.name === 'AbortError') {
          return;
        }
        setHit({ data: null, error: err.message });
      });
    return () => ctl.abort();
  }, []);

  // Hydrate the entries' track ids into playable tracks (dedup, capped so a
  // long journal can't fan out into dozens of catalog calls).
  const entries = useMemo(() => hit.data?.entries ?? [], [hit.data]);
  useEffect(() => {
    if (!entries.length) {
      return undefined;
    }
    const ids = [];
    for (const e of entries) {
      for (const item of (e.tracks ?? []).slice(0, THUMBS_PER_ENTRY)) {
        const id = typeof item === 'string' ? item : item?.id;
        if (id && !ids.includes(id)) {
          ids.push(id);
        }
      }
    }
    let on = true;
    Promise.all(
      ids.slice(0, HYDRATE_CAP).map(id =>
        getTrack(id)
          .then(track => [id, track])
          .catch(() => null),
      ),
    ).then(pairs => {
      if (on) {
        setThumbs(Object.fromEntries(pairs.filter(Boolean)));
      }
    });
    return () => {
      on = false;
    };
  }, [entries]);

  const pickLive = track => {
    player.playTrack(track, { source: 'your journal' });
    player.ui?.openPlayer?.();
  };

  const trackFor = item => {
    if (typeof item === 'string') {
      return thumbs[item] ?? null;
    }
    return item?.id ? item : null;
  };

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <ScreenFade>
        <BounceScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <PressScale
            accessibilityRole="button"
            accessibilityLabel="back"
            onPress={() => navigation.goBack()}
            hitSlop={10}
            style={styles.back}
          >
            <Icon name="chevron-left" size={22} color={t.ink} />
          </PressScale>

          <Text style={[label(10), { color: t.inkFaint }]}>
            Your private listening journal
          </Text>
          <Text style={[styles.hero, { color: t.ink }]}>
            What you listened{'\n'}to, and why.
          </Text>

          {status === 'loading' && (
            <View style={styles.center}>
              <AuraLoader label="Reading your journal" />
            </View>
          )}

          {status === 'error' && (
            <Text style={[styles.errorText, { color: t.inkSoft }]}>
              Couldn't load the journal — {hit.error}
            </Text>
          )}

          {status === 'ok' && entries.length === 0 && (
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: t.ink }]}>
                Your journal is waiting on you.
              </Text>
              <Text style={[styles.emptyBody, { color: t.inkSoft }]}>
                Listen for a while — entries appear once you've played a
                handful of songs.
              </Text>
            </View>
          )}

          {status === 'ok' &&
            entries.map((e, i) => (
              <View
                key={e.date ?? i}
                style={[styles.entry, { borderTopColor: t.line }]}
              >
                <View style={styles.entryMeta}>
                  <Text style={[label(10), { color: t.inkFaint }]}>
                    {e.label || e.date}
                  </Text>
                  {!!e.tag && (
                    <View
                      style={[styles.tag, { backgroundColor: t.accentSoft }]}
                    >
                      <Text style={[label(9), { color: t.accent }]}>
                        {e.tag}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.entryHeadline, { color: t.ink }]}>
                  {e.headline}
                </Text>
                <Text style={[styles.entryBody, { color: t.inkSoft }]}>
                  {e.body}
                </Text>
                {(e.tracks ?? []).some(item => trackFor(item)) && (
                  <View style={styles.thumbBlock}>
                    <Text style={[label(9), { color: t.inkFaint }]}>
                      Tracks heard
                    </Text>
                    <View style={styles.thumbRow}>
                      {(e.tracks ?? [])
                        .slice(0, THUMBS_PER_ENTRY)
                        .map(item => trackFor(item))
                        .filter(Boolean)
                        .map(track => (
                          <PressScale
                            key={track.id}
                            accessibilityRole="button"
                            accessibilityLabel={`play ${cleanTitle(track.title)}`}
                            onPress={() => pickLive(track)}
                          >
                            <TrackArt track={track} size={44} radius={6} />
                          </PressScale>
                        ))}
                    </View>
                  </View>
                )}
              </View>
            ))}
        </BounceScrollView>
      </ScreenFade>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 22 },
  back: {
    width: 38,
    height: 38,
    justifyContent: 'center',
    marginLeft: -8,
    marginBottom: 6,
  },
  hero: {
    fontFamily: fonts.regular,
    fontSize: 34,
    lineHeight: 36,
    letterSpacing: -1.02,
    marginTop: 8,
    marginBottom: 22,
  },
  center: { paddingVertical: 48, alignItems: 'center' },
  errorText: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 21,
    paddingVertical: 24,
  },
  empty: { paddingVertical: 32, gap: 8 },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 18 },
  emptyBody: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  entry: {
    borderTopWidth: 1,
    paddingVertical: 18,
    gap: 8,
  },
  entryMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  tag: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  entryHeadline: {
    fontFamily: fonts.semibold,
    fontSize: 17,
    lineHeight: 22,
  },
  entryBody: {
    fontFamily: fonts.regular,
    fontSize: 14.5,
    lineHeight: 21,
  },
  thumbBlock: { gap: 8, marginTop: 4 },
  thumbRow: { flexDirection: 'row', gap: 8 },
});
