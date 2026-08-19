import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BounceScrollView } from '../components/ui/Bounce';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { useTrackDirection } from '../hooks/useTrackDirection';
import { getUser, getActiveExplicitOff } from '../lib/auth';
import { showToast } from '../lib/toast';
import { openTrackActions } from '../lib/trackActionsSheet';
import { homeCache } from '../lib/homeCache';
import { readSnapshot, snapshotOwner, writeSnapshot } from '../lib/snapshot';
import { dropExplicit } from '../lib/explicit';
import { getQuickPicks } from '../api/quickPicks';
import { getMostPlayed, getTopArtists, getRecentlyPlayed } from '../api/stats';
import { listPlaylists } from '../api/playlists';
import { listAutoPlaylists } from '../api/autoPlaylists';
import { getDiscoverHome } from '../api/discover';
import { getRelated } from '../api/related';
import {
  getHomeHero,
  getHomeNewForYou,
  getHomeStations,
  getTrack,
} from '../api/catalog';
import { logImpressions } from '../api/impressions';
import { useFeaturedPool } from '../hooks/useFeaturedPool';
import { useBackToTop } from '../hooks/useBackToTop';
import { usePullRefresh } from '../hooks/usePullRefresh';
import { useActiveMode } from '../hooks/useActiveMode';
import { TOPBAR_CLEARANCE } from '../components/nav/TopBar';
import { DOCK_CLEARANCE } from '../components/nav/Dock';
import { ScreenFade } from '../components/ui/ScreenFade';
import { SectionHeader } from '../components/home/SectionHeader';
import { QuickPicksWheel, DISC_COUNT } from '../components/home/QuickPicksWheel';
import { HeroBand } from '../components/home/HeroBand';
import { MemoryRail } from '../components/home/MemoryRail';
import { RelatedRail } from '../components/home/RelatedRail';
import { ArtistRail } from '../components/home/ArtistRail';
import { StationsGrid } from '../components/home/StationsGrid';
import { PlaylistGrid } from '../components/home/PlaylistGrid';
import { Skeleton } from '../components/ui/Skeleton';
import { ModeMixCard } from '../components/home/ModeMixCard';
import { NowPlayingBanner } from '../components/home/NowPlayingBanner';
import { BgPlayRail } from '../components/home/BgPlayRail';
import { QuietPanelBell } from '../components/home/QuietPanelBell';
import { PressScale } from '../components/ui/PressScale';
import { ConfirmPopup } from '../components/ui/ConfirmPopup';
import { isBackgroundPlay, setBackgroundPlay } from '../playback/engine';
import { storage } from '../storage/mmkv';
import { fonts, label } from '../theme/tokens';
import { artUrl } from '../utils/artUrl';
import { cleanTitle } from '../utils/title';
import { partOfDay } from '../utils/daypart';

// Warm, plain greetings per part of day — a few per phase so the line varies
// day to day instead of the same "good morning" forever. Late night comes
// first so the small hours never read as "good morning".
const GREETINGS = {
  night: ['Still up?', 'Up late?', 'Late night?'], // 23:00–04:59
  morning: ['Good morning', 'Morning', 'Rise and shine'], // 05:00–11:59
  afternoon: ['Good afternoon', 'Afternoon', 'Hey there'], // 12:00–16:59
  evening: ['Good evening', 'Evening', 'Good to see you'], // 17:00–22:59
};

function greetingBucket(hour) {
  if (hour >= 23 || hour < 5) {
    return 'night';
  }
  if (hour < 12) {
    return 'morning';
  }
  if (hour < 17) {
    return 'afternoon';
  }
  return 'evening';
}

function greeting() {
  const opts = GREETINGS[greetingBucket(new Date().getHours())];
  // Rotate deterministically by the day, so it's fresh but stable within a day.
  const day = Math.floor(Date.now() / 86400000);
  return opts[day % opts.length];
}

// Cache-first section fetch (web homeCache contract): state seeds
// synchronously from the cache so tab returns render fully without a cascade;
// the fetch runs only when the in-memory key is absent. A persisted snapshot
// of the last session's data fills the very first paint of a cold start too —
// but it never suppresses the fetch, so it's shown-while-refreshing, and the
// fresh result overwrites both layers. Failures resolve to [] without
// caching, so a later visit retries. null = nothing to show yet.
//
// `fresh` is the pull-to-refresh handshake, and it is a nonce rather than a
// second fetch path: refreshHome() below re-fetches every section and writes
// the results into homeCache, then bumps the nonce — this effect re-runs, sees
// a populated key, and hands the section the fresh list. One fetch per section
// per refresh, the cache and the snapshots stay the sources of truth, and
// nothing here needs to know a refresh happened.
function useHomeSection(key, fetcher, fresh = 0) {
  const [data, setData] = useState(
    () => homeCache[key] ?? readSnapshot(`home.${key}`),
  );
  useEffect(() => {
    if (homeCache[key] !== undefined) {
      // Mount: the initializer already read this, and React bails on an
      // identical value. After a refresh: this is where the new list lands.
      setData(homeCache[key]);
      return undefined;
    }
    let stale = false;
    const as = snapshotOwner();
    fetcher()
      .then(d => {
        homeCache[key] = d;
        writeSnapshot(`home.${key}`, d, as);
        if (!stale) {
          setData(d);
        }
      })
      .catch(() => {
        if (!stale) {
          setData(prev => prev ?? []);
        }
      });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fresh]);
  return data;
}

// The six cache-first sections, as data — the pull-to-refresh below re-runs
// exactly this map, so a section can never be added to Home and forgotten by
// the refresh.
const HOME_SECTIONS = {
  quickPicks: getQuickPicks,
  mostPlayed: getMostPlayed,
  recentlyPlayed: getRecentlyPlayed,
  topArtists: getTopArtists,
  yourPlaylists: listPlaylists,
  discover: getDiscoverHome,
};

// The three personalization calls resolve as one surface, and both the effect
// that loads them and the refresh that re-loads them need the same shape —
// so the shape is written once, here.
const fetchReco = () =>
  Promise.all([getHomeHero(), getHomeNewForYou(), getHomeStations()]).then(
    ([h, n, s]) => ({
      hero: h?.track ? h : null,
      newForYou: n?.tracks?.length ? n.tracks : null,
      stations: s?.stations?.length ? s.stations : null,
    }),
  );

// Reco resolved with nothing personal in it — distinct from `null`, which
// means "still asking". Module scope so it is a stable effect dependency.
const NO_RECO = { hero: null, newForYou: null, stations: null };

// "don't ask again" for the background-play confirm popup.
const BG_NO_CONFIRM_KEY = 'aura.backgroundPlayNoConfirm';

export default function HomeScreen({ navigation }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  // Deep-scroll signal for the dock's back-to-top contraction. Lifted into a
  // hook so every long list can produce it — Home was the only screen that
  // did, which is why it was the only screen with the affordance.
  const backToTop = useBackToTop();
  // Filmstrip direction of the last track change — the banner steps with it.
  const trackDir = useTrackDirection(player.queue);
  const user = getUser();
  const firstName = user?.name?.split(' ')[0]?.toLowerCase();
  // A question greeting ("still up?") reads wrong with a comma after it, so the
  // name follows on a plain space; statement greetings ("good morning") keep
  // their comma.
  const greet = greeting();
  const explicitOff = getActiveExplicitOff();

  // Background play — the greeting-row switch. Flips the engine's app-killed
  // behavior; a popup confirms each flip unless the user opted out of asking.
  const [bgPlay, setBgPlayState] = useState(isBackgroundPlay);
  const [bgAsk, setBgAsk] = useState(null); // { next } while the popup is up
  const [bgDontAsk, setBgDontAsk] = useState(false);
  const applyBgPlay = next => {
    setBgPlayState(next);
    setBackgroundPlay(next).catch(() => {});
    showToast(next ? 'Background play on.' : 'Background play off.');
  };
  const onBgToggle = () => {
    const next = !bgPlay;
    if (storage.getItem(BG_NO_CONFIRM_KEY) === '1') {
      applyBgPlay(next);
      return;
    }
    setBgDontAsk(false);
    setBgAsk({ next });
  };
  const confirmBgPlay = () => {
    if (bgDontAsk) {
      storage.setItem(BG_NO_CONFIRM_KEY, '1');
    }
    applyBgPlay(bgAsk.next);
    setBgAsk(null);
  };

  const pool = useFeaturedPool({ limit: 24 });
  // Bumped by a pull-to-refresh once every section's fresh data is in the
  // cache; see refreshHome below.
  const [fresh, setFresh] = useState(0);
  const quickPicks = useHomeSection('quickPicks', HOME_SECTIONS.quickPicks, fresh);
  const mostPlayed = useHomeSection('mostPlayed', HOME_SECTIONS.mostPlayed, fresh);
  const recent = useHomeSection(
    'recentlyPlayed',
    HOME_SECTIONS.recentlyPlayed,
    fresh,
  );
  const topArtists = useHomeSection('topArtists', HOME_SECTIONS.topArtists, fresh);
  const yourPlaylists = useHomeSection(
    'yourPlaylists',
    HOME_SECTIONS.yourPlaylists,
    fresh,
  );
  const discover = useHomeSection('discover', HOME_SECTIONS.discover, fresh);

  // Made-for-you is the one stale-while-revalidate fetch (web contract):
  // cached mixes render instantly, a fresh list swaps in on every mount
  // (mixes go stale mid-session — hidden tracks, edition boundaries).
  const [autoMixes, setAutoMixes] = useState(
    () => homeCache.autoPlaylists ?? readSnapshot('home.autoPlaylists'),
  );
  useEffect(() => {
    let stale = false;
    const as = snapshotOwner();
    listAutoPlaylists()
      .then(p => {
        homeCache.autoPlaylists = p;
        writeSnapshot('home.autoPlaylists', p, as);
        if (!stale) {
          setAutoMixes(p);
        }
      })
      .catch(() => {
        if (!stale) {
          setAutoMixes(prev => prev ?? []);
        }
      });
    return () => {
      stale = true;
    };
  }, []);

  // "More like {what you're playing}" — the same related-tracks engine that
  // picks the radio, surfaced as a browsable shelf. Seeded by the CURRENTLY
  // PLAYING track so it tracks the music live (falls back to the newest
  // history entry when nothing's playing). Debounced so rapid skips don't
  // thrash the shelf, and cached by seed so returning to Home is instant.
  const nowPlaying = player.current;
  const [moreLikeSeed, setMoreLikeSeed] = useState(
    () => player.current ?? recent?.[0] ?? null,
  );
  useEffect(() => {
    const seed = nowPlaying ?? recent?.[0] ?? null;
    if (!seed?.id) {
      return undefined;
    }
    // Settle for a moment so a burst of skips doesn't re-seed on each one —
    // the shelf follows what you actually stay on.
    const id = setTimeout(() => setMoreLikeSeed(seed), 2500);
    return () => clearTimeout(id);
  }, [nowPlaying, recent]);

  const [moreLike, setMoreLike] = useState(() => homeCache.moreLike ?? null);
  useEffect(() => {
    if (!moreLikeSeed?.id || homeCache.moreLike?.seedId === moreLikeSeed.id) {
      return undefined;
    }
    let stale = false;
    getRelated(moreLikeSeed.id, { lang: moreLikeSeed.language, limit: 12 })
      .then(list => {
        const entry = {
          seedId: moreLikeSeed.id,
          seedTitle: cleanTitle(moreLikeSeed.title),
          tracks: list.filter(x => x.id !== moreLikeSeed.id),
        };
        homeCache.moreLike = entry;
        if (!stale) {
          setMoreLike(entry);
        }
      })
      .catch(() => {
        // Transient — the shelf just doesn't render this visit.
      });
    return () => {
      stale = true;
    };
  }, [moreLikeSeed]);

  // Quick-picks fallback chain (web DesktopHome): server ring ≥4 after the
  // family filter → most played ≥4 → recently played ≥4 → the pool. Sliced to
  // the wheel's own capacity so the impressions logged below are exactly the
  // picks that rendered.
  const served = dropExplicit(quickPicks ?? [], explicitOff);
  const serverRing = served.length >= 4;
  const picks = (
    serverRing
      ? served
      : (mostPlayed?.length ?? 0) >= 4
      ? mostPlayed
      : (recent?.length ?? 0) >= 4
      ? recent
      : pool.tracks
  ).slice(0, DISC_COUNT);

  // Personalized home surfaces from the server (server/homeReco): hero,
  // new-for-you, stations. Cached so returning to Home is instant; each field
  // stays null when there's no personalization (cold-start / not deployed), and
  // the featured pool fills that surface in below — never a fabricated "for you".
  const [reco, setReco] = useState(
    () => homeCache.reco ?? readSnapshot('home.reco'),
  );
  // This effect had an EMPTY dependency array, and Home is a memoized tab
  // screen that never unmounts — so hero, new-for-you and stations kept the
  // mode's personalization from whenever the app started, for the whole
  // session. The mode name in the header and the mode-mix card updated
  // instantly, which made the mismatch visible without explaining it.
  const { mode: activeMode, epoch: modeEpoch } = useActiveMode();
  const shownRecoMode = useRef(activeMode);
  useEffect(() => {
    let stale = false;
    const as = snapshotOwner();
    // Mirrors the featured pool's rule exactly: keep what is on screen while
    // the new mode loads, EXCEPT into a mode that filters explicit — the
    // previous mode's picks must never flash under a stricter one.
    if (shownRecoMode.current !== activeMode) {
      shownRecoMode.current = activeMode;
      if (getActiveExplicitOff()) {
        setReco(null);
      }
    }
    fetchReco()
      .then(next => {
        if (stale) {
          return;
        }
        homeCache.reco = next;
        writeSnapshot('home.reco', next, as);
        setReco(next);
      })
      .catch(() => {
        // No .catch used to exist: a rejection left `reco` null forever, which
        // read as "no personalization" and was invisible because the featured
        // pool fills that surface anyway. It stops being invisible the moment
        // a loading state keys off null, so settle it explicitly. Not cached —
        // a later visit retries, same as useHomeSection's failure path.
        if (!stale) {
          setReco(NO_RECO);
        }
      });
    return () => {
      stale = true;
    };
  }, [activeMode, modeEpoch]);

  // Log SHOWN picks so the ranker can demote never-played ones — only when
  // the server ring is what rendered; the local fallback is never logged.
  useEffect(() => {
    if (serverRing && picks.length) {
      logImpressions(
        'quick-picks',
        picks.map(p => p.id),
      );
    }
  }, [serverRing, picks]);

  const poolLoading = pool.status === 'loading';
  // Personalized hero, drawn from your own listening and rotated daily
  // (server/homeReco). When there isn't one — too little history, a content-
  // filtered mode (family/kids), or the server not deployed yet — a featured
  // pick fills in, and even THAT rotates daily so it's never the same album for
  // weeks (the static-hero complaint).
  // Personalization is skipped in content-filtered modes (family/kids), where
  // the mode-seeded featured pool leads instead.
  const personalHero = !explicitOff ? reco?.hero : null;
  const heroFallbackIdx = pool.tracks.length
    ? Math.floor(Date.now() / 86400000) % Math.min(pool.tracks.length, 6)
    : 0;
  const hero = personalHero?.track ?? pool.tracks[heroFallbackIdx] ?? null;
  const heroReason = personalHero?.reason ?? null;

  // "New for you": real discovery from the server, else the featured slice.
  const newPicks =
    (!explicitOff && reco?.newForYou) || pool.tracks.slice(1, 5);
  const newPicksPersonal = !explicitOff && !!reco?.newForYou;
  // The rail used to be gated on `poolLoading` alone. When the featured pool
  // resolved with nothing to slice (empty, or a short set), newPicks was []
  // and the whole section simply was not rendered — then it popped into
  // existence, unannounced, whenever the personal call landed. Both sources
  // have to be in before "nothing here" is the truth.
  const newPicksLoading =
    (poolLoading || reco == null) && newPicks.length === 0;

  // Stations: real per-artist radio seeds (mapped to the grid's track shape),
  // else featured tiles. `station:true` routes the tap to a radio, not the set.
  const stations =
    !explicitOff && reco?.stations
      ? reco.stations.map(s => ({
          id: s.seedId,
          title: s.title,
          artist: s.artist,
          imageUrl: s.imageUrl,
          language: s.language,
          station: true,
        }))
      : pool.tracks.slice(5, 9);

  // Web daypart gating: the morning mix shows 5:00–11:59, night 20:00–3:59.
  const hour = new Date().getHours();
  const visibleAuto = (autoMixes ?? []).filter(a =>
    a.mixKey === 'morning'
      ? hour >= 5 && hour < 12
      : a.mixKey === 'night'
      ? hour >= 20 || hour < 4
      : true,
  );

  // Field report: first open with no signal is a greeting over blank space —
  // nothing on disk to paint and every section self-hides when empty, so a
  // failed cold fetch read as a broken app rather than a failed load. Gated on
  // the pool having failed AND nothing else having reached the screen; one
  // cached rail means home has content and stays as it is. No NetInfo here, so
  // the copy can't say you're offline, only that it couldn't load — and retry
  // re-runs the pool fetch, which is what fills a first-run home.
  const homeBlank =
    pool.status === 'error' &&
    !hero &&
    !picks.length &&
    !stations.length &&
    !newPicks.length &&
    !recent?.length &&
    !topArtists?.length &&
    !yourPlaylists?.length &&
    !visibleAuto.length &&
    !moreLike?.tracks?.length &&
    !discover?.popularPlaylists?.length;

  // activeMode comes from useActiveMode above rather than being re-derived
  // from the inline getUser() read — that read does not re-render on an auth
  // change, so the two could disagree after a switch.
  const modeLabel =
    (user?.modes ?? []).find(m => m.key === activeMode)?.label ?? activeMode;

  const openPlayer = () => player.ui?.openPlayer?.();
  // Queue the whole pool starting at this track ("tonight's set", web pickById).
  const pickFromPool = track => {
    const idx = pool.tracks.findIndex(x => x.id === track.id);
    player.playQueue(pool.tracks, Math.max(0, idx), "tonight's set");
    openPlayer();
  };
  const pickLive = track => {
    player.playTrack(track, { source: 'your pick' });
    openPlayer();
  };
  // More-like tiles open the track menu on tap AND long-press — new listeners
  // expect choices, not instant playback. "play song" keeps the old tap
  // semantics: the rail is the recommended set, queued whole from that tile.
  const pickMoreLike = (track, i) =>
    openTrackActions({
      track,
      menu: {
        play: () => {
          player.playQueue(moreLike.tracks, i, 'more like this');
          openPlayer();
        },
      },
    });
  // A station tile starts a real radio from its seed: hydrate the seed + pull
  // its related tracks and play them as a queue (auto-radio extends from there).
  const pickStation = async station => {
    try {
      const [seed, related] = await Promise.all([
        getTrack(station.id).catch(() => null),
        getRelated(station.id, {
          lang: station.language,
          limit: 20,
        }).catch(() => []),
      ]);
      const list = [seed, ...related].filter(Boolean);
      const queue = list.filter(
        (tk, i) => tk.id && list.findIndex(x => x.id === tk.id) === i,
      );
      if (!queue.length) {
        showToast("Couldn't start that station.");
        return;
      }
      player.playQueue(queue, 0, `radio · ${station.artist}`);
      openPlayer();
    } catch {
      showToast("Couldn't start that station.");
    }
  };
  // A mix card opens the set (web onOpenAuto) — the full track list travels
  // as initialData since auto mixes have no per-id endpoint. Gate cards say
  // why they're locked instead.
  const openMix = item => {
    if (item.mix.kind === 'auto-gate' || !item.mix.tracks?.length) {
      showToast(item.meta || "This mix isn't ready yet");
      return;
    }
    navigation.navigate('CatalogPlaylist', { initialData: item.mix });
  };

  // ── Pull to refresh ──────────────────────────────────────────────────
  //
  // Home is cache-first by design: every section reads homeCache and skips its
  // fetch when the key is present, which is what makes a tab return instant
  // and is also why a stale Home used to have no way back short of killing the
  // app. The pull is that way back, and it goes through the SAME fetchers the
  // sections use — it refills the cache (and the on-disk snapshots) and then
  // bumps `fresh` so every section reads what just landed.
  //
  // Not a useCallback: usePullRefresh holds this in a ref and calls the latest
  // one, so a plain function keeps the closure honest without an identity that
  // has to be maintained.
  //
  // What it deliberately leaves alone: the featured pool (it re-runs itself,
  // below) and the more-like-this shelf, which is keyed by the track you are
  // PLAYING and re-seeds itself when that changes — a pull cannot make it any
  // fresher than the music already does.
  //
  // allSettled, not all: a shelf whose fetch failed keeps what it already had
  // — half a Home is still a Home — and only a refresh where EVERY call failed
  // (the offline case) is worth telling the user about, which the re-throw
  // does through usePullRefresh's one sentence.
  const refreshHome = () => {
    const as = snapshotOwner();
    // The featured pool carries its own status and skeletons, so it re-runs
    // itself rather than reporting through this spinner.
    pool.retry();
    const jobs = [
      ...Object.entries(HOME_SECTIONS).map(([key, fetcher]) =>
        fetcher().then(d => {
          homeCache[key] = d;
          writeSnapshot(`home.${key}`, d, as);
        }),
      ),
      listAutoPlaylists().then(p => {
        homeCache.autoPlaylists = p;
        writeSnapshot('home.autoPlaylists', p, as);
        setAutoMixes(p);
      }),
      fetchReco().then(next => {
        homeCache.reco = next;
        writeSnapshot('home.reco', next, as);
        setReco(next);
      }),
    ];
    return Promise.allSettled(jobs).then(results => {
      setFresh(n => n + 1);
      if (results.every(r => r.status === 'rejected')) {
        throw results[0].reason;
      }
    });
  };
  // The top bar floats over the scroller, so the spinner starts below it
  // rather than under the glass.
  const pull = usePullRefresh(refreshHome, {
    offset: insets.top + TOPBAR_CLEARANCE,
  });

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <ScreenFade>
        <BounceScrollView
          {...backToTop}
          refreshControl={pull.control}
          contentContainerStyle={[
            styles.content,
            // The bar floats over the scroller now (web: position fixed) —
            // content starts under the glass and slides beneath it.
            { paddingTop: insets.top + TOPBAR_CLEARANCE },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.pad, styles.greetRow]}>
            <View style={styles.greetCol}>
              <Text style={[styles.greeting, { color: t.ink }]}>
                {greet}
                {firstName
                  ? `${greet.endsWith('?') ? ' ' : ', '}${firstName}`
                  : ''}
              </Text>
              <Text style={[styles.tagline, { color: t.inkSoft }]}>
                Music that gets your mood
              </Text>
              {/* The 2b status line: recolors with the switch. */}
              <Text
                style={[
                  label(9.5),
                  styles.bgStatus,
                  { color: bgPlay ? t.accent : t.inkFaint },
                ]}
              >
                {bgPlay ? 'Plays in background' : 'Stops when you leave'}
              </Text>
            </View>
            {/* The 2b rail (owner's reference): bell on top, then the full-
                height vertical switch — the rail IS the toggle, its knob
                travels the greeting block's height. */}
            <View style={styles.headActions}>
              <QuietPanelBell />
              <BgPlayRail value={bgPlay} onPress={onBgToggle} />
            </View>
          </View>

          {activeMode !== 'everyday' && (
            <ModeMixCard
              modeLabel={modeLabel}
              tracks={pool.tracks}
              loading={poolLoading}
              onPlayAll={() => {
                player.playQueue(pool.tracks, 0, `${modeLabel} mix`);
                openPlayer();
              }}
            />
          )}

          <NowPlayingBanner
            track={player.current}
            dir={trackDir}
            playing={player.isPlaying}
            onOpen={openPlayer}
          />

          {homeBlank && (
            <View style={[styles.pad, styles.blank]}>
              <Text style={[styles.blankLine, { color: t.ink }]}>
                Couldn't load your music.
              </Text>
              <Text style={[styles.blankSub, { color: t.inkSoft }]}>
                Check your connection and try again.
              </Text>
              <PressScale
                accessibilityRole="button"
                accessibilityLabel="try again"
                onPress={pool.retry}
                style={[styles.blankRetry, { borderColor: t.line }]}
              >
                <Text style={[styles.blankSub, { color: t.inkSoft }]}>
                  Try again
                </Text>
              </PressScale>
            </View>
          )}

          {picks.length > 0 && (
            <View>
              <SectionHeader
                title="Quick picks"
                sub={
                  serverRing
                    ? `Your ${partOfDay()} picks`
                    : 'Jump back into what you love'
                }
              />
              <View style={styles.wheelWrap}>
                <QuickPicksWheel
                  tracks={picks}
                  currentId={player.current?.id}
                  onPick={pickLive}
                />
              </View>
            </View>
          )}

          <HeroBand
            track={hero}
            reason={heroReason}
            loading={poolLoading && !hero}
            onBegin={() => {
              if (!hero) {
                return;
              }
              // A personal hero starts a radio from itself; a featured-pool
              // hero opens the set from its spot in the pool.
              if (personalHero?.track) {
                pickLive(hero);
              } else {
                pickFromPool(hero);
              }
            }}
          />

          {(recent?.length ?? 0) > 0 && (
            <View>
              <SectionHeader
                title="Recently played"
                sub={`${recent.length} tracks to pick up from`}
              />
              <MemoryRail tracks={recent} onPick={pickLive} />
            </View>
          )}

          {(moreLike?.tracks?.length ?? 0) > 0 && (
            <View>
              <SectionHeader
                title={`More like ${moreLike.seedTitle}`}
                sub="Because you played it recently"
              />
              <RelatedRail
                tracks={moreLike.tracks}
                onPick={pickMoreLike}
                onLongPress={pickMoreLike}
              />
            </View>
          )}

          {(topArtists?.length ?? 0) > 0 && (
            <View>
              <SectionHeader
                title="Your top artists"
                sub="Artists you play most"
              />
              <ArtistRail
                artists={topArtists}
                onOpen={a =>
                  navigation.navigate('Artist', {
                    name: a.artist,
                    trackId: a.sampleTrack?.id,
                  })
                }
              />
            </View>
          )}

          {(poolLoading || stations.length > 0) && (
            <View>
              <SectionHeader
                title="Stations"
                sub={
                  reco?.stations && !explicitOff
                    ? 'Radios from your artists'
                    : 'Start from any song'
                }
              />
              <StationsGrid
                stations={stations}
                loading={poolLoading}
                onPick={track =>
                  track.station ? pickStation(track) : pickFromPool(track)
                }
              />
            </View>
          )}

          {(yourPlaylists?.length ?? 0) > 0 && (
            <View>
              <SectionHeader
                title="Made by you"
                sub="Your playlists"
                seeAllLabel="see all playlists"
                onSeeAll={() => navigation.navigate('Playlists')}
              />
              <PlaylistGrid
                items={yourPlaylists.slice(0, 4).map(p => ({
                  id: p.id,
                  name: p.name,
                  cover: p.coverImageUrl,
                  meta: `${p.trackCount} ${
                    p.trackCount === 1 ? 'track' : 'tracks'
                  }`,
                }))}
                onPressItem={item =>
                  navigation.navigate('Playlist', { id: item.id })
                }
              />
            </View>
          )}

          {visibleAuto.length > 0 && (
            <View>
              <SectionHeader
                title="Made for you"
                sub="Fresh editions from your plays — skips count"
                seeAllLabel="see all made for you"
                onSeeAll={() => navigation.navigate('Playlists')}
              />
              <PlaylistGrid
                items={visibleAuto.map(a => ({
                  id: a.id,
                  name: a.name,
                  cover: a.coverImageUrl,
                  mix: a,
                  meta:
                    a.kind === 'auto-gate'
                      ? a.gate?.line
                      : [
                          a.editionLabel ?? a.description,
                          a.cadence,
                          a.refreshing ? 'refreshing…' : null,
                        ]
                          .filter(Boolean)
                          .join(' · '),
                }))}
                onPressItem={openMix}
              />
            </View>
          )}

          {(newPicksLoading || newPicks.length > 0) && (
            <View>
              <SectionHeader
                title="New for you"
                sub={newPicksPersonal ? 'From your listening' : 'Fresh this week'}
              />
              {newPicksLoading ? (
                <View style={styles.skeletonGrid}>
                  {[0, 1, 2, 3].map(i => (
                    <Skeleton key={i} radius={8} style={styles.skeletonCell} />
                  ))}
                </View>
              ) : (
                <PlaylistGrid
                  items={newPicks.map(track => ({
                    id: track.id,
                    name: cleanTitle(track.title),
                    cover: artUrl(track, 500),
                    meta: track.artist,
                    track,
                  }))}
                  onPressItem={item =>
                    newPicksPersonal
                      ? pickLive(item.track)
                      : pickFromPool(item.track)
                  }
                />
              )}
            </View>
          )}

          {(discover?.popularPlaylists?.length ?? 0) > 0 && (
            <View>
              <SectionHeader title="Popular playlists" sub="Trending now" />
              <PlaylistGrid
                items={discover.popularPlaylists.slice(0, 4).map(p => ({
                  id: p.id,
                  name: p.name,
                  cover: p.coverImageUrl,
                  meta: p.subtitle?.toLowerCase(),
                }))}
                onPressItem={item =>
                  navigation.navigate('CatalogPlaylist', { id: item.id })
                }
              />
            </View>
          )}
        </BounceScrollView>
      </ScreenFade>
      <ConfirmPopup
        visible={!!bgAsk}
        title={
          bgAsk?.next
            ? 'Turn on background play?'
            : 'Turn off background play?'
        }
        body={
          bgAsk?.next
            ? 'Music keeps playing when you close the app.'
            : 'Music stops when you close the app.'
        }
        action={bgAsk?.next ? 'Turn on' : 'Turn off'}
        onConfirm={confirmBgPlay}
        onCancel={() => setBgAsk(null)}
        dontAsk={bgDontAsk}
        onToggleDontAsk={() => setBgDontAsk(v => !v)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    gap: 28,
    // paddingTop rides inline: insets.top + TOPBAR_CLEARANCE (the bar floats).
    paddingBottom: 24 + DOCK_CLEARANCE,
  },
  pad: { paddingHorizontal: 22, gap: 4 },
  // flex-start so the corner stack's bell tops out level with the greeting's
  // first line — the block's true corner, not its vertical middle.
  // stretch: the rail switch fills the greeting block's height (2b).
  greetRow: { flexDirection: 'row', alignItems: 'stretch', gap: 16 },
  // Centered against the rail column's height (2b: the text block floats
  // mid-height beside the full-height switch).
  greetCol: { flex: 1, gap: 4, justifyContent: 'center' },
  headActions: { width: 36, alignItems: 'center', gap: 10 },
  bgStatus: { marginTop: 10 },
  greeting: { fontFamily: fonts.semibold, fontSize: 26 },
  tagline: { fontFamily: fonts.regular, fontSize: 13.5 },
  wheelWrap: { alignItems: 'center', paddingTop: 6 },
  blank: { alignItems: 'center', gap: 8, paddingVertical: 28 },
  blankLine: { fontFamily: fonts.semibold, fontSize: 17 },
  blankSub: { fontFamily: fonts.regular, fontSize: 13.5, textAlign: 'center' },
  blankRetry: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
    marginTop: 4,
  },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 14,
    justifyContent: 'space-between',
    paddingHorizontal: 22,
  },
  skeletonCell: {
    flexBasis: '48%',
    aspectRatio: 1,
    height: undefined,
  },
});
