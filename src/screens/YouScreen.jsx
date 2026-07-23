import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { BounceScrollView } from '../components/ui/Bounce';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import {
  clearMyAvatar,
  disableFamilyMode,
  enableFamilyMode,
  getUser,
  logout,
  setMyAvatar,
  subscribeAuth,
  updatePreferences,
} from '../lib/auth';
import { uploadImage } from '../api/uploads';
import { pickImage } from '../lib/imagePicker';
import { showToast } from '../lib/toast';
import { getPushPrefs, setPushPrefs } from '../lib/push';
import { confirm } from '../lib/confirm';
import { QUALITIES } from '../lib/audioQuality';
import { LEVELING_MODES } from '../lib/leveling';
import { openWhatsNew } from '../lib/whatsNew';
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
import { readSnapshot, snapshotOwner, writeSnapshot } from '../lib/snapshot';
import { TopBar } from '../components/nav/TopBar';
import { Avatar } from '../components/Avatar';
import { DOCK_CLEARANCE } from '../components/nav/Dock';
import { ScreenFade } from '../components/ui/ScreenFade';
import { PressScale } from '../components/ui/PressScale';
import { Shelf } from '../components/library/Shelf';
import { AuraLoader } from '../components/ui/AuraLoader';
import { CountUp } from '../components/ui/CountUp';
import { TrackArt } from '../components/TrackRow';
import { Icon } from '../components/Icon';
import { fonts, label } from '../theme/tokens';
import { EASE } from '../theme/motion';
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

// Staggered rise-in for the cards below — each waits its turn, so opening
// the tab reads as the library composing itself rather than popping on.
// Driven by a plain animated style, NOT an `entering` layout animation: a
// session that expires under us tears the whole navigator down (auth 401 →
// clearSession → Shell swaps to the sign-in screen), and reanimated 4.2.3 on
// Fabric aborts natively when a view is removed mid-entering. A shared value
// is simply cancelled on unmount.
function Arrive({ i = 0, children }) {
  const reduced = useReducedMotion();
  const p = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) {
      p.value = 1;
      return undefined;
    }
    p.value = withDelay(
      70 * i,
      withTiming(1, { duration: 380, easing: EASE.enter }),
    );
    return () => cancelAnimation(p);
  }, [i, p, reduced]);
  const style = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateY: (1 - p.value) * 14 }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

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
  // Subscribed (not just read) so an avatar change repaints the chip at once.
  const [user, setUser] = useState(getUser);
  useEffect(() => subscribeAuth(() => setUser(getUser())), []);
  const { isLiked, ready } = useLikes();

  // Cold starts paint from the last session's library snapshot instantly (no
  // loader) — load() below still refetches on mount + every tab focus and
  // silently swaps the fresh data in.
  const [snap] = useState(() => readSnapshot('you'));
  const [summary, setSummary] = useState(() => snap?.summary ?? null);
  const [liked, setLiked] = useState(() => snap?.liked ?? null);
  const [playlists, setPlaylists] = useState(() => snap?.playlists ?? null);
  const [history, setHistory] = useState(() => snap?.history ?? null);
  const [loaded, setLoaded] = useState(() => !!snap);
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

  // Family mode — a PIN-gated toggle. Off → reveal a "set a PIN" field; on →
  // reveal an "enter your PIN to turn off" field. familyMode rides the live
  // user (enable/disable persistUser, so it reacts at once).
  const familyOn = !!user?.familyMode;
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const submitFamily = async () => {
    if (pinBusy) {
      return;
    }
    if (!/^\d{4,6}$/.test(pin)) {
      showToast('enter a 4–6 digit PIN');
      return;
    }
    setPinBusy(true);
    try {
      if (familyOn) {
        await disableFamilyMode(pin);
        showToast('family mode is off.');
      } else {
        await enableFamilyMode(pin);
        showToast('family mode is on.');
      }
      setPin('');
      setPinOpen(false);
    } catch (err) {
      const left = err.attemptsLeft;
      showToast(
        typeof left === 'number'
          ? `that PIN isn't right — ${left} left`
          : err.message,
      );
    } finally {
      setPinBusy(false);
    }
  };

  // Welcome screen (the "sensing" intro) — the hard on/off on top of the
  // once-a-day cadence. Default on for accounts cached before the preference
  // existed (web parity). Optimistic: the row flips at once and reverts if the
  // save fails; on success updatePreferences persists the refreshed user, so
  // the launch gate (App computeFlow → showSensing) reads it next cold start.
  const [sensingOverride, setSensingOverride] = useState(null);
  const sensingOn = sensingOverride ?? (user?.showSensing !== false);
  const sensingBusy = sensingOverride !== null;
  const toggleSensing = async () => {
    if (sensingBusy) {
      return;
    }
    const next = !sensingOn;
    setSensingOverride(next);
    try {
      await updatePreferences({ showSensing: next });
      showToast(next ? 'welcome screen is on.' : 'welcome screen is off.');
    } catch (err) {
      showToast(`couldn't update — ${err.message}`);
    } finally {
      setSensingOverride(null);
    }
  };

  // Notification switches — server-persisted (the sender checks the same row
  // before every triggered push, so a switch here silences that category for
  // every device). Loaded when the settings shelf opens, like the hidden
  // list; each row flips optimistically and reverts if the save fails.
  const [pushPrefs, setPushPrefsState] = useState(null);
  useEffect(() => {
    if (openShelf !== 'settings' || pushPrefs) {
      return undefined;
    }
    let live = true;
    getPushPrefs()
      .then(p => {
        if (live) {
          setPushPrefsState(p);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [openShelf, pushPrefs]);
  const togglePushPref = async key => {
    if (!pushPrefs) {
      return;
    }
    const prev = pushPrefs;
    const flipped = !prev[key];
    setPushPrefsState({ ...prev, [key]: flipped });
    try {
      setPushPrefsState(await setPushPrefs({ [key]: flipped }));
    } catch (err) {
      setPushPrefsState(prev);
      showToast(`couldn't update — ${err.message}`);
    }
  };

  // Admin composer — one settings row routing to the AdminCompose SCREEN
  // (live preview + fields; a full screen, per the sheets-are-for-menus
  // rule). Rendered only when the server marked this account admin
  // (sanitizeUser.admin rides the cached user); every admin route re-checks
  // the allowlist server-side regardless.
  const isAdmin = !!user?.admin;

  // Profile photo — upload (picker delivers it pre-resized) or remove; the
  // cached user updates via persistUser so every avatar on screen refreshes.
  const [avatarBusy, setAvatarBusy] = useState(false);
  const changePhoto = async () => {
    if (avatarBusy) {
      return;
    }
    try {
      const asset = await pickImage('avatar');
      if (!asset) {
        return;
      }
      setAvatarBusy(true);
      const { url } = await uploadImage(asset, { kind: 'avatar' });
      await setMyAvatar(url);
      showToast('photo updated.');
    } catch (err) {
      showToast(`couldn't update photo — ${err.message}`);
    } finally {
      setAvatarBusy(false);
    }
  };
  const removePhoto = async () => {
    if (avatarBusy) {
      return;
    }
    setAvatarBusy(true);
    try {
      await clearMyAvatar();
      showToast('photo removed.');
    } catch (err) {
      showToast(err.message);
    } finally {
      setAvatarBusy(false);
    }
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
    const as = snapshotOwner();
    // null (never []) means "this one failed" — an empty array is a real
    // answer and has to stay distinguishable from a dead fetch.
    Promise.all([
      getLibrarySummary().catch(() => null),
      listLiked().catch(() => null),
      listPlaylists().catch(() => null),
      getHistory({ limit: 4 })
        .then(r => r.plays)
        .catch(() => null),
    ]).then(([s, l, p, h]) => {
      // Snapshot only a fully-successful load. A failed shelf must not freeze
      // "0 tracks played" or an empty library into next session's paint.
      if (s && l && p && h) {
        writeSnapshot(
          'you',
          { summary: s, liked: l, playlists: p, history: h },
          as,
        );
      }
      if (!alive.current) {
        return;
      }
      // Stale-while-revalidate cuts both ways: what came back replaces what is
      // on screen, what failed leaves it alone. Offline, the snapshot-painted
      // library stays put instead of being overwritten with confident zeros.
      if (s) {
        setSummary(s);
      }
      if (l) {
        setLiked(l);
      }
      if (p) {
        setPlaylists(p);
      }
      if (h) {
        setHistory(h);
      }
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

  const confirmSignOut = async () => {
    if (
      await confirm({
        title: 'sign out?',
        body: 'you can sign back in anytime.',
        action: 'sign out',
        // Signing out unmounts the navigator this sheet lives in — it can't
        // still be animating out when that happens.
        instant: true,
      })
    ) {
      logout();
    }
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
          <Arrive i={0}>
          <View
            style={[
              styles.yearCard,
              { backgroundColor: t.accentCard },
            ]}
          >
            <Text style={[label(9.5), { color: t.inkFaint }]}>your year</Text>
            {!loaded ? (
              // Blobs only — the card's own "your year" label already names
              // it; the goo breathing IS the aura, no gray bars.
              <AuraLoader style={styles.yearLoader} />
            ) : (
              <>
                <Text style={[styles.yearLine, { color: t.ink }]}>
                  <CountUp to={summary?.tracksPlayed ?? 0} /> tracks played
                </Text>
                <Text style={[label(10), { color: t.inkSoft }]}>
                  for <CountUp to={summary?.minutesListened ?? 0} /> minutes
                </Text>
              </>
            )}
          </View>
          </Arrive>

          {loaded && summary && summary.tracksPlayed === 0 && (
            <Text style={[styles.allEmpty, { color: t.inkSoft }]}>
              Nothing played yet. Your library fills as you listen.
            </Text>
          )}

          {/* The written-about-you pair: journal + sonic dna. */}
          <Arrive i={1}>
          <View style={styles.duoRow}>
            <PressScale
              accessibilityRole="button"
              accessibilityLabel="your journal"
              onPress={() => navigation.navigate('Journal')}
              style={[
                styles.duoCard,
                { backgroundColor: t.surface, borderColor: t.line },
              ]}
            >
              <Text style={[label(9.5), { color: t.inkFaint }]}>
                your journal
              </Text>
              <Text style={[styles.duoSub, { color: t.inkSoft }]}>
                what you listened to, and why.
              </Text>
            </PressScale>
            <PressScale
              accessibilityRole="button"
              accessibilityLabel="sonic dna"
              onPress={() => navigation.navigate('Dna')}
              style={[
                styles.duoCard,
                { backgroundColor: t.surface, borderColor: t.line },
              ]}
            >
              <Text style={[label(9.5), { color: t.inkFaint }]}>sonic dna</Text>
              <Text style={[styles.duoSub, { color: t.inkSoft }]}>
                you, as a fingerprint.
              </Text>
            </PressScale>
          </View>
          </Arrive>

          {/* Mood bridges — gradual paths between feelings. */}
          <Arrive i={2}>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel="mood bridges"
            onPress={() => navigation.navigate('Bridges')}
            style={[
              styles.bridgeCard,
              { backgroundColor: t.accentCard },
            ]}
          >
            <Text style={[label(9.5), { color: t.inkFaint }]}>mood bridges</Text>
            <Text style={[styles.bridgeTitle, { color: t.ink }]}>
              from here to there
            </Text>
            <Text style={[styles.duoSub, { color: t.inkSoft }]}>
              songs threaded so the mood shifts gradually — or let the bridge
              read you.
            </Text>
          </PressScale>
          </Arrive>

          {!loaded ? (
            <View style={styles.shelvesLoading}>
              <AuraLoader label="opening your library" />
            </View>
          ) : (
            <Arrive i={3}>
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
                  profile photo
                </Text>
                <View style={styles.photoRow}>
                  <Avatar user={user} size={44} />
                  <Text
                    style={[styles.qualityCaption, styles.photoCaption, { color: t.inkSoft }]}
                  >
                    {user?.avatarUrl
                      ? 'your photo'
                      : 'add a photo, or keep the initial'}
                  </Text>
                  {!!user?.avatarUrl && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="remove photo"
                      disabled={avatarBusy}
                      onPress={removePhoto}
                      hitSlop={8}
                      style={({ pressed }) => pressed && styles.pressed}
                    >
                      <Text style={[label(9.5), { color: t.inkSoft }]}>
                        remove
                      </Text>
                    </Pressable>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={user?.avatarUrl ? 'change photo' : 'add photo'}
                    disabled={avatarBusy}
                    onPress={changePhoto}
                    hitSlop={8}
                    style={({ pressed }) => pressed && styles.pressed}
                  >
                    <Text style={[label(9.5), { color: t.accent }]}>
                      {avatarBusy
                        ? 'uploading…'
                        : user?.avatarUrl
                        ? 'change'
                        : 'add photo'}
                    </Text>
                  </Pressable>
                </View>

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
                  family mode
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="family mode"
                  accessibilityState={familyOn ? { selected: true } : {}}
                  onPress={() => {
                    setPin('');
                    setPinOpen(o => !o);
                  }}
                  style={({ pressed }) => [
                    styles.qualityRow,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.rowMeta}>
                    <Text
                      style={[
                        styles.rowTitle,
                        { color: familyOn ? t.accent : t.ink },
                      ]}
                    >
                      family mode
                    </Text>
                    <Text style={[styles.qualityCaption, { color: t.inkSoft }]}>
                      {familyOn
                        ? 'explicit songs are hidden. enter your PIN to turn it off.'
                        : 'hide explicit songs. set a PIN to lock it.'}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.dot,
                      { borderColor: familyOn ? t.accent : t.line },
                      familyOn && { backgroundColor: t.accent },
                    ]}
                  />
                </Pressable>
                {pinOpen && (
                  <View style={styles.pinRow}>
                    <TextInput
                      value={pin}
                      onChangeText={v => setPin(v.replace(/\D/g, ''))}
                      onSubmitEditing={submitFamily}
                      placeholder={
                        familyOn ? 'PIN to turn off' : 'set a 4–6 digit PIN'
                      }
                      placeholderTextColor={t.inkFaint}
                      cursorColor={t.accent}
                      selectionColor={t.accent}
                      secureTextEntry
                      keyboardType="number-pad"
                      maxLength={6}
                      accessibilityLabel="family mode PIN"
                      style={[
                        styles.pinInput,
                        { color: t.ink, borderColor: t.line, backgroundColor: t.bg },
                      ]}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={familyOn ? 'turn off' : 'turn on'}
                      onPress={submitFamily}
                      disabled={pinBusy}
                      style={({ pressed }) => [
                        styles.pinBtn,
                        { borderColor: t.accent },
                        (pinBusy || pressed) && styles.pressed,
                      ]}
                    >
                      <Text style={[label(9.5), { color: t.accent }]}>
                        {familyOn ? 'turn off' : 'turn on'}
                      </Text>
                    </Pressable>
                  </View>
                )}

                <Text style={[label(9.5), styles.settingHead, { color: t.inkFaint }]}>
                  welcome screen
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="welcome screen"
                  accessibilityState={sensingOn ? { selected: true } : {}}
                  disabled={sensingBusy}
                  onPress={toggleSensing}
                  style={({ pressed }) => [
                    styles.qualityRow,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.rowMeta}>
                    <Text
                      style={[
                        styles.rowTitle,
                        { color: sensingOn ? t.accent : t.ink },
                      ]}
                    >
                      welcome screen
                    </Text>
                    <Text
                      style={[styles.qualityCaption, { color: t.inkSoft }]}
                    >
                      {sensingOn
                        ? 'a short intro reads your mood when you open aura. shows once a day — tap it to skip.'
                        : 'skipped — you go straight to your home.'}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.dot,
                      { borderColor: sensingOn ? t.accent : t.line },
                      sensingOn && { backgroundColor: t.accent },
                    ]}
                  />
                </Pressable>

                <Text style={[label(9.5), styles.settingHead, { color: t.inkFaint }]}>
                  notifications
                </Text>
                {[
                  {
                    key: 'mixes',
                    title: 'new music for you',
                    onCap: 'a heads-up when your daily mixes are ready.',
                    offCap: 'no mix announcements.',
                  },
                  {
                    key: 'social',
                    title: 'friends & playlists',
                    onCap: 'someone joins your playlist or adds a song.',
                    offCap: 'playlist activity stays quiet.',
                  },
                  {
                    key: 'nudges',
                    title: 'listening reminders',
                    onCap: "an occasional nudge when your music's been waiting a while.",
                    offCap: 'no reminders.',
                  },
                ].map(row => {
                  const on = pushPrefs ? pushPrefs[row.key] !== false : true;
                  return (
                    <Pressable
                      key={row.key}
                      accessibilityRole="button"
                      accessibilityLabel={row.title}
                      accessibilityState={on ? { selected: true } : {}}
                      disabled={!pushPrefs}
                      onPress={() => togglePushPref(row.key)}
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
                          {row.title}
                        </Text>
                        <Text
                          style={[styles.qualityCaption, { color: t.inkSoft }]}
                        >
                          {on ? row.onCap : row.offCap}
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

                {isAdmin && (
                  <>
                    <Text style={[label(9.5), styles.settingHead, { color: t.inkFaint }]}>
                      admin
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="send a notification"
                      onPress={() => navigation.navigate('AdminCompose')}
                      style={({ pressed }) => [
                        styles.qualityRow,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.rowMeta}>
                        <Text style={[styles.rowTitle, { color: t.ink }]}>
                          send a notification
                        </Text>
                        <Text style={[styles.qualityCaption, { color: t.inkSoft }]}>
                          compose a push with a live preview of the card.
                        </Text>
                      </View>
                    </Pressable>
                  </>
                )}

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

                {/* Volume leveling — evens out loud masters toward the chosen
                    target (attenuate-only; see lib/leveling). */}
                <Text style={[label(9.5), styles.settingHead, { color: t.inkFaint }]}>
                  volume leveling
                </Text>
                {LEVELING_MODES.map(m => {
                  const on = player.leveling === m.id;
                  return (
                    <Pressable
                      key={m.id}
                      accessibilityRole="button"
                      accessibilityLabel={`leveling ${m.label}`}
                      accessibilityState={on ? { selected: true } : {}}
                      onPress={() => player.setLeveling(m.id)}
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
                          {m.label}
                        </Text>
                        <Text style={[styles.qualityCaption, { color: t.inkSoft }]}>
                          {m.caption}
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

                {/* Reopen the update guide anytime. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="what's new"
                  onPress={openWhatsNew}
                  style={({ pressed }) => [
                    styles.qualityRow,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.rowMeta}>
                    <Text style={[styles.rowTitle, { color: t.ink }]}>
                      what's new
                    </Text>
                    <Text style={[styles.qualityCaption, { color: t.inkSoft }]}>
                      the latest features, explained
                    </Text>
                  </View>
                </Pressable>

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
            </Arrive>
          )}

          {/* Identity chip — you sign the corner of your own screen.
              Display-only. */}
          <Animated.View layout={CHIP_LAYOUT} style={styles.identity}>
            <Avatar user={user} size={44} />
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
  // Left-aligned in the year card (AuraLoader centers by default) and sized
  // to the two text lines it stands in for.
  yearLoader: { alignItems: 'flex-start', paddingVertical: 2 },
  shelvesLoading: { paddingVertical: 24 },
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
  duoRow: { flexDirection: 'row', gap: 10 },
  duoCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 4,
  },
  duoSub: {
    fontFamily: fonts.regular,
    fontSize: 12.5,
    lineHeight: 17,
  },
  bridgeCard: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 15,
    gap: 4,
  },
  bridgeTitle: {
    fontFamily: fonts.semibold,
    fontSize: 20,
    letterSpacing: -0.3,
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
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  pinInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontFamily: fonts.regular,
    fontSize: 15,
    letterSpacing: 2,
  },
  pinBtn: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
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
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 8,
  },
  photoCaption: { flex: 1, minWidth: 0 },
  who: { flex: 1, gap: 1 },
  name: { fontFamily: fonts.medium, fontSize: 15.5 },
  email: { fontFamily: fonts.regular, fontSize: 12.5 },
});
