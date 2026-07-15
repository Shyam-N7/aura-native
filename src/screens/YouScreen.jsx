import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { LinearTransition, ReduceMotion } from 'react-native-reanimated';
import { BounceScrollView } from '../components/ui/Bounce';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { getUser, logout } from '../lib/auth';
import { showToast } from '../lib/toast';
import { QUALITIES } from '../lib/audioQuality';
import {
  isPrivateSession,
  privateSessionUntil,
  setPrivateSession,
  subscribePrivateSession,
} from '../lib/privateSession';
import { getLibrarySummary } from '../api/library';
import { listLiked } from '../api/likes';
import { listPlaylists } from '../api/playlists';
import { getHistory } from '../api/stats';
import { listHidden, unhideTrack } from '../api/hidden';
import { invalidateHomeCache } from '../lib/homeCache';
import { openTrackActions } from '../lib/trackActionsSheet';
import { useLikes } from '../hooks/useLikes';
import { bumpHint, hintAvailable, killHint } from '../lib/tapHint';
import { getLastCrash, clearLastCrash } from '../lib/crashLog';
import { TopBar } from '../components/nav/TopBar';
import { DOCK_CLEARANCE } from '../components/nav/Dock';
import { ScreenFade } from '../components/ui/ScreenFade';
import { Shelf } from '../components/library/Shelf';
import { Skeleton } from '../components/home/Skeleton';
import { TrackArt } from '../components/TrackRow';
import { Icon } from '../components/Icon';
import { fonts, label } from '../theme/tokens';
import { cleanTitle } from '../utils/title';

// The library ("you" tab), ported from web DesktopLibrary: pinned "your year"
// stats, then a single-open accordion — liked / playlists / history /
// languages / settings — with an identity chip signing the bottom.

// Web PRIMARY_LANGUAGES (src/data/languages.js) — the language-hub entry
// chips. The hub screens themselves arrive with the catalog-browse phase.
const HOME_LANGS = [
  'tamil',
  'english',
  'hindi',
  'malayalam',
  'kannada',
  'telugu',
];

// Which shelf is open survives player round-trips but not an app restart
// (web keeps it in sessionStorage for the same reason: fresh visits land on
// the calm all-closed composition).
let sessionShelf = null;

const CHIP_LAYOUT = LinearTransition.duration(280).reduceMotion(
  ReduceMotion.System,
);

// Overlapping cover fan — the closed-shelf "peek" (three 26px arts).
function PeekFan({ tracks }) {
  return (
    <View style={styles.fan}>
      {tracks.slice(0, 3).map((tr, i) => (
        <View key={`${tr.id}-${i}`} style={i > 0 && styles.fanOverlap}>
          <TrackArt track={tr} size={26} radius={5} />
        </View>
      ))}
    </View>
  );
}

// One shelf row: 50px art, title, lowercase artist · language sub, ⋯ menu.
function ShelfRow({ track, onPress }) {
  const { t } = useTheme();
  const title = cleanTitle(track.title);
  const openMenu = () => openTrackActions({ track, menu: {} });
  return (
    <View style={styles.rowWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`play ${title}`}
        onPress={onPress}
        onLongPress={openMenu}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <TrackArt track={track} size={50} radius={4} />
        <View style={styles.rowMeta}>
          <Text numberOfLines={1} style={[styles.rowTitle, { color: t.ink }]}>
            {title}
          </Text>
          <Text
            numberOfLines={1}
            style={[label(9.5), { color: t.inkSoft }]}
          >
            {(track.artist ?? '').toLowerCase()} · {track.language ?? ''}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="more"
        onPress={openMenu}
        hitSlop={8}
        style={({ pressed }) => [styles.more, pressed && styles.pressed]}
      >
        <Icon name="dots" size={17} color={t.inkFaint} />
      </Pressable>
    </View>
  );
}

function SeeAll({ what, onPress }) {
  const { t } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`see all ${what}`}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.seeAll, pressed && styles.pressed]}
    >
      <Text style={[label(9.5), { color: t.accent }]}>see all →</Text>
    </Pressable>
  );
}

export default function YouScreen({ navigation }) {
  const { t } = useTheme();
  const player = usePlayer();
  const user = getUser();
  const { isLiked, ready } = useLikes();

  const [summary, setSummary] = useState(null);
  const [liked, setLiked] = useState(null);
  const [playlists, setPlaylists] = useState(null);
  const [history, setHistory] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [openShelf, setOpenShelf] = useState(() => sessionShelf);
  const [crash, setCrash] = useState(getLastCrash);
  const [hintOn] = useState(() => hintAvailable('libraryShelf'));
  const alive = useRef(true);

  // Hidden songs — the visible "don't show this again" list (mixes and
  // auto-radio never pick these). Loaded when the settings shelf opens;
  // unhide prunes locally so it reacts at once.
  const [hidden, setHidden] = useState(null);
  const [hiddenError, setHiddenError] = useState(false);
  const [priv, setPriv] = useState(isPrivateSession);
  useEffect(() => subscribePrivateSession(setPriv), []);

  const togglePrivate = () => {
    const next = !priv;
    setPrivateSession(next);
    showToast(next ? 'private session on.' : 'private session off.');
  };
  const privUntil = privateSessionUntil();
  const privCaption =
    priv && privUntil
      ? `on · until ${new Date(privUntil)
          .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
          .toLowerCase()}`
      : "what you play won't shape your mixes.";
  useEffect(() => {
    if (openShelf !== 'settings') {
      return undefined;
    }
    let live = true;
    setHiddenError(false);
    listHidden()
      .then(h => {
        if (live) {
          setHidden(h);
        }
      })
      .catch(() => {
        if (live) {
          setHiddenError(true);
        }
      });
    return () => {
      live = false;
    };
  }, [openShelf]);

  const unhideOne = async id => {
    try {
      await unhideTrack(id);
      setHidden(hs => (hs ?? []).filter(h => h.id !== id));
      // Same staleness as hiding, in reverse.
      invalidateHomeCache('autoPlaylists', 'quickPicks');
      showToast('back in the mix.');
    } catch (err) {
      showToast(err.message);
    }
  };

  useEffect(() => {
    if (hintOn) {
      bumpHint('libraryShelf');
    }
  }, [hintOn]);

  // Four independent best-effort fetches (web contract: one failure never
  // blanks the screen). Refetched quietly on every tab focus — the web gets
  // the same freshness from remounting the screen per visit.
  const load = useCallback(() => {
    Promise.all([
      getLibrarySummary().catch(() => null),
      listLiked().catch(() => []),
      listPlaylists().catch(() => []),
      getHistory({ limit: 4 })
        .then(r => r.plays)
        .catch(() => []),
    ]).then(([s, l, p, h]) => {
      if (!alive.current) {
        return;
      }
      setSummary(s);
      setLiked(l);
      setPlaylists(p);
      setHistory(h);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    const unsub = navigation?.addListener?.('focus', load);
    return () => {
      alive.current = false;
      unsub?.();
    };
  }, [navigation, load]);

  const toggleShelf = id => {
    killHint('libraryShelf');
    const next = openShelf === id ? null : id;
    setOpenShelf(next);
    sessionShelf = next;
  };

  const openPlayer = () => player.ui?.openPlayer?.();
  // Unliking anywhere (player heart) drops the row here instantly; `ready`
  // guards the boot race where an unbooted like-set would hide everything.
  const likedRows = (liked ?? []).filter(x => !ready || isLiked(x.id));

  const playLiked = i => {
    player.playQueue(likedRows, i, 'your liked');
    openPlayer();
  };
  const pickLive = track => {
    player.playTrack(track, { source: 'your pick' });
    openPlayer();
  };

  const confirmSignOut = () => {
    Alert.alert('sign out?', 'you can sign back in anytime.', [
      { text: 'cancel', style: 'cancel' },
      { text: 'sign out', style: 'destructive', onPress: () => logout() },
    ]);
  };

  const emptyPeek = (
    <Text style={[label(9.5), { color: t.inkFaint }]}>nothing yet</Text>
  );
  const countPeek = n => (
    <Text style={[label(10), { color: t.inkFaint }]}>{n}</Text>
  );

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <TopBar navigation={navigation} />
      <ScreenFade>
        <BounceScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Your year — pinned open at the top: the listener's data is just
              there on arrival, no action needed. */}
          <View
            style={[
              styles.yearCard,
              { backgroundColor: t.accentCard },
            ]}
          >
            <Text style={[label(9.5), { color: t.inkFaint }]}>your year</Text>
            {!loaded ? (
              <Skeleton height={18} radius={6} style={styles.yearSkeleton} />
            ) : (
              <>
                <Text style={[styles.yearLine, { color: t.ink }]}>
                  {summary?.tracksPlayed ?? 0} tracks played
                </Text>
                <Text style={[label(10), { color: t.inkSoft }]}>
                  for {summary?.minutesListened ?? 0} minutes
                </Text>
              </>
            )}
          </View>

          {loaded && summary && summary.tracksPlayed === 0 && (
            <Text style={[styles.allEmpty, { color: t.inkSoft }]}>
              Nothing played yet. Your library fills as you listen.
            </Text>
          )}

          {!loaded ? (
            <View style={styles.shelves}>
              {[0, 1, 2].map(i => (
                <Skeleton key={i} height={58} radius={16} />
              ))}
            </View>
          ) : (
            <View style={styles.shelves}>
              <Shelf
                title="liked songs"
                open={openShelf === 'liked'}
                onToggle={() => toggleShelf('liked')}
                hint={
                  hintOn && openShelf === null ? (
                    <Text style={[styles.hint, label(8), { color: t.accent }]}>
                      tap to open
                    </Text>
                  ) : null
                }
                peek={
                  likedRows.length > 0 ? (
                    <>
                      <PeekFan tracks={likedRows} />
                      {countPeek(likedRows.length)}
                    </>
                  ) : (
                    emptyPeek
                  )
                }
              >
                {likedRows.length === 0 && (
                  <Text style={[styles.emptyRow, { color: t.inkSoft }]}>
                    No liked songs yet. Tap the heart on any track.
                  </Text>
                )}
                {likedRows.slice(0, 4).map((tr, i) => (
                  <ShelfRow key={tr.id} track={tr} onPress={() => playLiked(i)} />
                ))}
                {likedRows.length > 0 && (
                  <SeeAll
                    what="liked songs"
                    onPress={() => navigation.navigate('Liked')}
                  />
                )}
              </Shelf>

              <Shelf
                title="playlists"
                open={openShelf === 'playlists'}
                onToggle={() => toggleShelf('playlists')}
                peek={
                  (playlists?.length ?? 0) > 0 ? (
                    <>
                      <PeekFan
                        tracks={playlists.map(p => ({
                          id: p.id,
                          title: p.name,
                          imageUrl: p.coverImageUrl,
                        }))}
                      />
                      {countPeek(playlists.length)}
                    </>
                  ) : (
                    emptyPeek
                  )
                }
              >
                {(playlists?.length ?? 0) === 0 && (
                  <Text style={[styles.emptyRow, { color: t.inkSoft }]}>
                    No playlists yet. Create one from any song's menu.
                  </Text>
                )}
                {(playlists ?? []).slice(0, 10).map(p => (
                  <Pressable
                    key={p.id}
                    accessibilityRole="button"
                    accessibilityLabel={p.name}
                    onPress={() =>
                      navigation.navigate('Playlist', { id: p.id })
                    }
                    style={({ pressed }) => [
                      styles.row,
                      pressed && styles.pressed,
                    ]}
                  >
                    <TrackArt
                      track={{ id: p.id, title: p.name, imageUrl: p.coverImageUrl }}
                      size={50}
                      radius={4}
                    />
                    <View style={styles.rowMeta}>
                      <Text
                        numberOfLines={1}
                        style={[styles.rowTitle, { color: t.ink }]}
                      >
                        {p.name}
                      </Text>
                      <Text style={[label(9.5), { color: t.inkSoft }]}>
                        {p.trackCount} {p.trackCount === 1 ? 'track' : 'tracks'}
                      </Text>
                    </View>
                  </Pressable>
                ))}
                <SeeAll
                  what="playlists"
                  onPress={() => navigation.navigate('Playlists')}
                />
              </Shelf>

              <Shelf
                title="history"
                open={openShelf === 'history'}
                onToggle={() => toggleShelf('history')}
                peek={
                  (history?.length ?? 0) > 0 ? (
                    <PeekFan tracks={history} />
                  ) : (
                    emptyPeek
                  )
                }
              >
                {(history?.length ?? 0) === 0 && (
                  <Text style={[styles.emptyRow, { color: t.inkSoft }]}>
                    No history yet. It fills in as you listen.
                  </Text>
                )}
                {(history ?? []).map((tr, i) => (
                  <ShelfRow
                    key={`${tr.id}-${i}`}
                    track={tr}
                    onPress={() => pickLive(tr)}
                  />
                ))}
                {(history?.length ?? 0) > 0 && (
                  <SeeAll
                    what="history"
                    onPress={() => navigation.navigate('History')}
                  />
                )}
              </Shelf>

              <Shelf
                title="languages"
                open={openShelf === 'languages'}
                onToggle={() => toggleShelf('languages')}
                peek={
                  <View style={styles.fan}>
                    {HOME_LANGS.map(L => (
                      <View
                        key={L}
                        style={[styles.langDot, { backgroundColor: t.accentSoft }]}
                      >
                        <Text style={[styles.langDotText, { color: t.accent }]}>
                          {L[0]}
                        </Text>
                      </View>
                    ))}
                  </View>
                }
              >
                <View style={styles.langRow}>
                  {HOME_LANGS.map(L => (
                    <Pressable
                      key={L}
                      accessibilityRole="button"
                      accessibilityLabel={`language ${L}`}
                      onPress={() =>
                        navigation.navigate('LanguageHub', { lang: L })
                      }
                      style={({ pressed }) => [
                        styles.lang,
                        { borderColor: t.line },
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.langText, { color: t.ink }]}>{L}</Text>
                    </Pressable>
                  ))}
                </View>
              </Shelf>

              <Shelf
                title="settings"
                open={openShelf === 'settings'}
                onToggle={() => toggleShelf('settings')}
                peek={<Icon name="cog" size={18} color={t.inkFaint} strokeWidth={1.6} />}
              >
                <Text style={[label(9.5), styles.settingHead, { color: t.inkFaint }]}>
                  privacy
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="private session"
                  accessibilityState={priv ? { selected: true } : {}}
                  onPress={togglePrivate}
                  style={({ pressed }) => [
                    styles.qualityRow,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.rowMeta}>
                    <Text
                      style={[
                        styles.rowTitle,
                        { color: priv ? t.accent : t.ink },
                      ]}
                    >
                      private session
                    </Text>
                    <Text
                      style={[styles.qualityCaption, { color: t.inkSoft }]}
                    >
                      {privCaption}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.dot,
                      { borderColor: priv ? t.accent : t.line },
                      priv && { backgroundColor: t.accent },
                    ]}
                  />
                </Pressable>

                <Text style={[label(9.5), styles.settingHead, { color: t.inkFaint }]}>
                  audio quality
                </Text>
                {QUALITIES.map(q => {
                  const on = player.quality === q.id;
                  return (
                    <Pressable
                      key={q.id}
                      accessibilityRole="button"
                      accessibilityLabel={`quality ${q.label}`}
                      accessibilityState={on ? { selected: true } : {}}
                      onPress={() => player.setQuality(q.id)}
                      style={({ pressed }) => [
                        styles.qualityRow,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.rowMeta}>
                        <Text
                          style={[
                            styles.rowTitle,
                            { color: on ? t.accent : t.ink },
                          ]}
                        >
                          {q.label}
                        </Text>
                        <Text style={[styles.qualityCaption, { color: t.inkSoft }]}>
                          {q.caption}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.dot,
                          { borderColor: on ? t.accent : t.line },
                          on && { backgroundColor: t.accent },
                        ]}
                      />
                    </Pressable>
                  );
                })}

                <Text
                  style={[label(9.5), styles.settingHead, { color: t.inkFaint }]}
                >
                  made for you
                </Text>
                {hidden === null && !hiddenError && (
                  <Text style={[styles.emptyRow, { color: t.inkSoft }]}>
                    loading…
                  </Text>
                )}
                {hiddenError && (
                  <Text style={[styles.emptyRow, { color: t.inkSoft }]}>
                    couldn't load hidden songs — try reopening settings.
                  </Text>
                )}
                {hidden !== null && !hiddenError && hidden.length === 0 && (
                  <Text style={[styles.emptyRow, { color: t.inkSoft }]}>
                    no hidden songs. "don't show this again" on any mix track
                    lands here.
                  </Text>
                )}
                {(hidden ?? []).map(h => (
                  <View key={h.id} style={styles.hiddenRow}>
                    <View style={styles.rowMeta}>
                      <Text
                        numberOfLines={1}
                        style={[styles.rowTitle, { color: t.ink }]}
                      >
                        {(h.title || '').toLowerCase()}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[label(9.5), { color: t.inkSoft }]}
                      >
                        {(h.artist || '').toLowerCase() ||
                          "aura won't pick this for you"}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`unhide ${h.title}`}
                      onPress={() => unhideOne(h.id)}
                      hitSlop={8}
                      style={({ pressed }) => pressed && styles.pressed}
                    >
                      <Text style={[label(9.5), { color: t.accent }]}>
                        unhide
                      </Text>
                    </Pressable>
                  </View>
                ))}

                {crash && (
                  <View style={[styles.crashCard, { borderColor: t.line }]}>
                    <Text style={[label(9.5), { color: t.inkFaint }]}>
                      last crash report
                    </Text>
                    <Text style={[styles.crashText, { color: t.inkSoft }]}>
                      {new Date(crash.at).toLocaleString()} — {crash.message}
                    </Text>
                    {!!crash.stack && (
                      <Text
                        numberOfLines={6}
                        style={[styles.crashStack, { color: t.inkFaint }]}
                      >
                        {crash.stack}
                      </Text>
                    )}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="clear crash report"
                      onPress={() => {
                        clearLastCrash();
                        setCrash(null);
                      }}
                      hitSlop={8}
                    >
                      <Text style={[label(9.5), { color: t.accent }]}>
                        clear report
                      </Text>
                    </Pressable>
                  </View>
                )}

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="sign out"
                  onPress={confirmSignOut}
                  style={({ pressed }) => [
                    styles.signOut,
                    { borderColor: t.line },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.signOutText, { color: t.accent }]}>
                    sign out
                  </Text>
                </Pressable>
                <Text style={[styles.version, { color: t.inkFaint }]}>
                  aura · phase 2
                </Text>
              </Shelf>
            </View>
          )}

          {/* Identity chip — you sign the corner of your own screen.
              Display-only. */}
          <Animated.View layout={CHIP_LAYOUT} style={styles.identity}>
            <View style={[styles.avatar, { backgroundColor: t.accentSoft }]}>
              <Text style={[styles.avatarLetter, { color: t.accent }]}>
                {(user?.name ?? '·').trim()[0]?.toLowerCase() ?? '·'}
              </Text>
            </View>
            <View style={styles.who}>
              <Text numberOfLines={1} style={[styles.name, { color: t.ink }]}>
                {user?.name ?? ''}
              </Text>
              <Text numberOfLines={1} style={[styles.email, { color: t.inkSoft }]}>
                {user?.email ?? ''}
              </Text>
            </View>
          </Animated.View>
        </BounceScrollView>
      </ScreenFade>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 24 + DOCK_CLEARANCE,
    gap: 14,
  },
  yearCard: {
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 5,
  },
  yearSkeleton: { width: 160 },
  yearLine: {
    fontFamily: fonts.semibold,
    fontSize: 22,
    letterSpacing: -0.11,
  },
  allEmpty: {
    fontFamily: fonts.regular,
    fontSize: 13.5,
    paddingHorizontal: 2,
  },
  shelves: { gap: 10 },
  hint: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    marginTop: -6,
  },
  fan: { flexDirection: 'row', alignItems: 'center' },
  fanOverlap: { marginLeft: -9 },
  rowWrap: { flexDirection: 'row', alignItems: 'center' },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 7,
  },
  more: { paddingVertical: 10, paddingLeft: 8 },
  hiddenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  pressed: { opacity: 0.6 },
  rowMeta: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { fontFamily: fonts.medium, fontSize: 15 },
  emptyRow: {
    fontFamily: fonts.regular,
    fontSize: 13,
    paddingVertical: 8,
  },
  seeAll: {
    alignSelf: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 2,
  },
  langRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 4,
    paddingBottom: 6,
  },
  lang: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  langText: { fontFamily: fonts.medium, fontSize: 13.5 },
  langDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -4,
  },
  langDotText: { fontFamily: fonts.semibold, fontSize: 11 },
  settingHead: { marginTop: 4, marginBottom: 6 },
  qualityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  qualityCaption: { fontFamily: fonts.regular, fontSize: 12 },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
  },
  crashCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
    gap: 6,
  },
  crashText: { fontFamily: fonts.regular, fontSize: 12.5 },
  crashStack: {
    fontFamily: fonts.regular,
    fontSize: 10.5,
    lineHeight: 14,
  },
  signOut: {
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 14,
  },
  signOutText: { fontFamily: fonts.medium, fontSize: 14.5 },
  version: {
    fontFamily: fonts.regular,
    fontSize: 12,
    marginTop: 12,
    textAlign: 'center',
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 4,
    paddingTop: 6,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { fontFamily: fonts.semibold, fontSize: 19 },
  who: { flex: 1, gap: 1 },
  name: { fontFamily: fonts.medium, fontSize: 15.5 },
  email: { fontFamily: fonts.regular, fontSize: 12.5 },
});
