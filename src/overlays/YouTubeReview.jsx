import React, { useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BounceScrollView } from '../components/ui/Bounce';
import { DOCK_CLEARANCE } from '../components/nav/Dock';
import { useTheme } from '../theme/ThemeContext';
import { resolveItem, pollImport } from '../api/ytImport';
import { COPY, copyForCode } from '../lib/ytImportCopy';
import { showToast } from '../lib/toast';
import { artUrl } from '../utils/artUrl';
import { fonts, label, type } from '../theme/tokens';

// The review screen, ported from web src/screens/YouTubeReviewScreen.jsx.
//
// A COMPONENT here, not a stack route, and the reason is not style: two hosts
// need it — the import screen and PlaylistScreen after a refresh — and both
// need onDone(updated) to hand back a RE-POLLED job so their summary is not
// stale. Navigation cannot return a value from a pop, so as a route the job
// would have to ride in params, which is both the non-serializable-param
// warning and a snapshot taken before the review happened.
//
// This is not an error path, and it must not read like one. At the measured
// auto-match rate roughly a third of every import arrives here, so it is where
// a third of the result is actually decided — and the songs it holds are the
// HARD ones: covers, different recordings, transliterated titles, songs the
// catalogue spells another way. Getting these right is most of the difference
// between a playlist that feels imported and one that feels made.
//
// Three commitments, each of which costs layout:
//
//  1. Show why. Every candidate carries the parse READING that produced its
//     score — "A - B" is song-artist in Indian titles and artist-song in
//     Western ones, and the matcher scores both. Naming the winner turns an
//     arbitrary list into an explicable one.
//  2. Show enough to decide. Art, artist, album and duration, because duration
//     is very often the only thing separating a song from its own remix.
//  3. Never blame the user. A row with no candidates is the catalogue's limit,
//     not a mistake they made, and it says so.

function mmss(sec) {
  if (!Number.isFinite(sec) || sec <= 0) {
    return null;
  }
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// How far the candidate's length is from the video's. Shown rather than the raw
// score because "12s longer" is a fact the user can act on and "0.83" is not.
function driftLabel(candidateSec, ytSec) {
  if (!Number.isFinite(candidateSec) || !Number.isFinite(ytSec) || !ytSec) {
    return null;
  }
  const d = Math.round(candidateSec - ytSec);
  if (Math.abs(d) <= 3) {
    return 'same length';
  }
  return `${Math.abs(d)}s ${d > 0 ? 'longer' : 'shorter'}`;
}

function Art({ candidate }) {
  const { t } = useTheme();
  // Catalog urls carry an NxN size token; a 48px thumbnail has no business
  // pulling the hero variant over a phone connection.
  const uri = artUrl(candidate, 150);
  if (uri) {
    return <Image source={{ uri }} style={styles.cover} />;
  }
  return (
    <View
      style={[
        styles.cover,
        styles.coverFallback,
        { backgroundColor: t.accentSoft },
      ]}
    >
      <Text style={[styles.coverLetter, { color: t.accent }]}>
        {candidate.title?.[0]?.toUpperCase() ?? '·'}
      </Text>
    </View>
  );
}

export function YouTubeReview({ job, onDone, onOpenPlaylist }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();

  // Snapshot the queue once. Re-deriving it from `job` after every resolve
  // would make rows vanish from under the user's finger as they are answered —
  // the list must stay still while it is being worked through, which matters
  // more with a thumb than with a mouse.
  const queue = useMemo(
    () =>
      (job.items ?? []).filter(i => i.state === 'pending' && i.tier === 'review'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [job.id],
  );
  const missing = useMemo(
    () => (job.items ?? []).filter(i => i.tier === 'unmatched'),
    [job.items],
  );

  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(0);

  const item = queue[index];
  const finished = index >= queue.length;

  const advance = () => setIndex(i => i + 1);

  const answer = async trackId => {
    if (busy || !item) {
      return;
    }
    setBusy(true);
    try {
      await resolveItem(job.id, item.id, trackId ? { trackId } : { skip: true });
      if (trackId) {
        setAccepted(n => n + 1);
      }
      advance();
    } catch (err) {
      const copy = copyForCode(err.code, err.message);
      showToast(copy.title);
      // A candidate the server no longer recognises can't be chosen no matter
      // how many times it is tapped — move on rather than trapping the user on
      // a row they cannot answer.
      if (err.code === 'YT_NOT_OFFERED') {
        advance();
      }
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    // Re-read once on the way out so the caller's summary reflects the work
    // just done, instead of the counts from before review started.
    let updated = null;
    try {
      updated = await pollImport(job.id);
    } catch {
      /* summary stays stale — harmless */
    }
    onDone?.(updated);
  };

  // This covers its host rather than being pushed onto the stack, so hardware
  // back would otherwise pop the HOST — the import screen or the playlist —
  // straight out from under an open review. Same pattern as ui/Sheet.jsx:84.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: t.bg, paddingTop: insets.top },
      ]}
    >
      <BounceScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + DOCK_CLEARANCE },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.head}>
          <Text style={[label(9.5), { color: t.inkFaint }]}>
            {finished
              ? COPY.review.done
              : COPY.review.progress(
                  Math.min(index + 1, queue.length),
                  queue.length,
                )}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={finished ? COPY.done.open : COPY.review.skipAll}
            onPress={close}
            hitSlop={8}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Text style={[styles.quietAction, { color: t.inkSoft }]}>
              {finished ? COPY.done.open : COPY.review.skipAll}
            </Text>
          </Pressable>
        </View>

        {!finished && item && (
          <>
            <Text style={[type.queueHero, styles.hero, { color: t.ink }]}>
              {COPY.review.title}
            </Text>

            {/* What YouTube called it, and how we read it. The second line is
                the one that makes the choice below explicable. */}
            <View style={[styles.source, { backgroundColor: t.surface }]}>
              <Text style={[styles.sourceTitle, { color: t.ink }]}>
                {item.youtube?.title}
              </Text>
              <Text style={[label(8.5), { color: t.inkFaint }]}>
                {[item.youtube?.channel, mmss(item.youtube?.durationSec)]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              {item.candidates?.[0]?.reading && (
                <Text style={[styles.sourceRead, { color: t.inkSoft }]}>
                  {COPY.review.readAs(
                    item.candidates[0].reading.title,
                    item.candidates[0].reading.artists?.[0] ?? null,
                  )}
                </Text>
              )}
            </View>

            {(item.candidates ?? []).map(c => (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityLabel={c.title}
                disabled={busy}
                onPress={() => answer(c.id)}
                style={({ pressed }) => [styles.cand, pressed && styles.pressed]}
              >
                <Art candidate={c} />
                <View style={styles.candMeta}>
                  <Text
                    numberOfLines={1}
                    style={[styles.candTitle, { color: t.ink }]}
                  >
                    {c.title}
                  </Text>
                  <Text
                    numberOfLines={2}
                    style={[styles.candSub, { color: t.inkSoft }]}
                  >
                    {[
                      c.artist,
                      c.album,
                      mmss(c.durationSec),
                      driftLabel(c.durationSec, item.youtube?.durationSec),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
              </Pressable>
            ))}

            {(item.candidates ?? []).length === 0 && (
              <View style={[styles.note, { backgroundColor: t.surface }]}>
                <Text style={[styles.noteTitle, { color: t.ink }]}>
                  {COPY.review.none}
                </Text>
                {/* Said plainly, because the natural reading of an empty list
                    is "I did something wrong". They did not — the catalogue
                    cannot answer some queries at all. */}
                <Text style={[styles.noteBody, { color: t.inkSoft }]}>
                  {COPY.review.noneHint}
                </Text>
              </View>
            )}

            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={COPY.review.skip}
                disabled={busy}
                onPress={() => answer(null)}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <Text style={[styles.quietAction, { color: t.inkSoft }]}>
                  {COPY.review.skip}
                </Text>
              </Pressable>
            </View>
          </>
        )}

        {finished && (
          <>
            <Text style={[type.queueHero, styles.hero, { color: t.ink }]}>
              {COPY.review.done}
            </Text>
            <View style={[styles.note, { backgroundColor: t.surface }]}>
              <Text style={[styles.noteTitle, { color: t.ink }]}>
                {COPY.done.ready(accepted)}
              </Text>
              <Text style={[styles.noteBody, { color: t.inkSoft }]}>
                {COPY.review.doneBody}
              </Text>
              {missing.length > 0 && (
                <Text style={[styles.noteBody, { color: t.inkFaint }]}>
                  {COPY.done.missing(missing.length)}
                </Text>
              )}
            </View>
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={COPY.done.open}
                onPress={() =>
                  job.playlistId ? onOpenPlaylist?.(job.playlistId) : close()
                }
                style={({ pressed }) => pressed && styles.pressed}
              >
                <Text style={[styles.goAction, { color: t.accent }]}>
                  {COPY.done.open}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </BounceScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 10, gap: 10 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  hero: { marginTop: 4, marginBottom: 6 },
  pressed: { opacity: 0.6 },
  source: { borderRadius: 12, padding: 14, gap: 5 },
  sourceTitle: { fontFamily: fonts.medium, fontSize: 15.5 },
  sourceRead: { fontFamily: fonts.regular, fontSize: 13 },
  cand: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  cover: { width: 48, height: 48, borderRadius: 8 },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  coverLetter: { fontFamily: fonts.semibold, fontSize: 19 },
  candMeta: { flex: 1, minWidth: 0, gap: 3 },
  candTitle: { fontFamily: fonts.medium, fontSize: 15 },
  candSub: { fontFamily: fonts.regular, fontSize: 12.5 },
  note: { borderRadius: 12, padding: 14, gap: 5 },
  noteTitle: { fontFamily: fonts.semibold, fontSize: 15 },
  noteBody: { fontFamily: fonts.regular, fontSize: 13.5 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 22,
    paddingVertical: 10,
  },
  quietAction: { fontFamily: fonts.medium, fontSize: 14.5 },
  goAction: { fontFamily: fonts.medium, fontSize: 14.5 },
});
