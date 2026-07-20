import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BounceScrollView } from '../components/ui/Bounce';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { getUser, getActiveExplicitOff } from '../lib/auth';
import { showToast } from '../lib/toast';
import { openTrackActions } from '../lib/trackActionsSheet';
import { homeCache } from '../lib/homeCache';
import { readSnapshot, writeSnapshot } from '../lib/snapshot';
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
import { TopBar } from '../components/nav/TopBar';
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
import { fonts } from '../theme/tokens';
import { artUrl } from '../utils/artUrl';
import { cleanTitle } from '../utils/title';
import { partOfDay } from '../utils/daypart';

// Warm, plain greetings per part of day — a few per phase so the line varies
// day to day instead of the same "good morning" forever. Late night comes
// first so the small hours never read as "good morning".
const GREETINGS = {
  night: ['still up?', 'up late?', 'late night?'], // 23:00–04:59
  morning: ['good morning', 'morning', 'rise and shine'], // 05:00–11:59
  afternoon: ['good afternoon', 'afternoon', 'hey there'], // 12:00–16:59
  evening: ['good evening', 'evening', 'good to see you'], // 17:00–22:59
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
function useHomeSection(key, fetcher) {
  const [data, setData] = useState(
    () => homeCache[key] ?? readSnapshot(`home.${key}`),
  );
  useEffect(() => {
    if (homeCache[key] !== undefined) {
      return undefined;
    }
    let stale = false;
    fetcher()
      .then(d => {
        homeCache[key] = d;
        writeSnapshot(`home.${key}`, d);
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
  }, [key]);
  return data;
}

export default function HomeScreen({ navigation }) {
  const { t } = useTheme();
  const player = usePlayer();
  const user = getUser();
  const firstName = user?.name?.split(' ')[0]?.toLowerCase();
  // A question greeting ("still up?") reads wrong with a comma after it, so the
  // name follows on a plain space; statement greetings ("good morning") keep
  // their comma.
  const greet = greeting();
  const explicitOff = getActiveExplicitOff();

  const pool = useFeaturedPool({ limit: 24 });
  const quickPicks = useHomeSection('quickPicks', getQuickPicks);
  const mostPlayed = useHomeSection('mostPlayed', getMostPlayed);
  const recent = useHomeSection('recentlyPlayed', getRecentlyPlayed);
  const topArtists = useHomeSection('topArtists', getTopArtists);
  const yourPlaylists = useHomeSection('yourPlaylists', listPlaylists);
  const discover = useHomeSection('discover', getDiscoverHome);

  // Made-for-you is the one stale-while-revalidate fetch (web contract):
  // cached mixes render instantly, a fresh list swaps in on every mount
  // (mixes go stale mid-session — hidden tracks, edition boundaries).
  const [autoMixes, setAutoMixes] = useState(
    () => homeCache.autoPlaylists ?? readSnapshot('home.autoPlaylists'),
  );
  useEffect(() => {
    let stale = false;
    listAutoPlaylists()
      .then(p => {
        homeCache.autoPlaylists = p;
        writeSnapshot('home.autoPlaylists', p);
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
  useEffect(() => {
    let stale = false;
    Promise.all([getHomeHero(), getHomeNewForYou(), getHomeStations()]).then(
      ([h, n, s]) => {
        if (stale) {
          return;
        }
        const next = {
          hero: h?.track ? h : null,
          newForYou: n?.tracks?.length ? n.tracks : null,
          stations: s?.stations?.length ? s.stations : null,
        };
        homeCache.reco = next;
        writeSnapshot('home.reco', next);
        setReco(next);
      },
    );
    return () => {
      stale = true;
    };
  }, []);

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

  const activeMode = user?.activeMode ?? 'everyday';
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
        showToast("couldn't start that station.");
        return;
      }
      player.playQueue(queue, 0, `radio · ${station.artist}`);
      openPlayer();
    } catch {
      showToast("couldn't start that station.");
    }
  };
  // A mix card opens the set (web onOpenAuto) — the full track list travels
  // as initialData since auto mixes have no per-id endpoint. Gate cards say
  // why they're locked instead.
  const openMix = item => {
    if (item.mix.kind === 'auto-gate' || !item.mix.tracks?.length) {
      showToast(item.meta || "this mix isn't ready yet");
      return;
    }
    navigation.navigate('CatalogPlaylist', { initialData: item.mix });
  };

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <TopBar navigation={navigation} />
      <ScreenFade>
        <BounceScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.pad}>
            <Text style={[styles.greeting, { color: t.ink }]}>
              {greet}
              {firstName ? `${greet.endsWith('?') ? ' ' : ', '}${firstName}` : ''}
            </Text>
            <Text style={[styles.tagline, { color: t.inkSoft }]}>
              music that gets your mood
            </Text>
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

          <NowPlayingBanner track={player.current} onOpen={openPlayer} />

          {picks.length > 0 && (
            <View>
              <SectionHeader
                title="quick picks"
                sub={
                  serverRing
                    ? `your ${partOfDay()} picks`
                    : 'jump back into what you love'
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
                title="recently played"
                sub={`${recent.length} tracks to pick up from`}
              />
              <MemoryRail tracks={recent} onPick={pickLive} />
            </View>
          )}

          {(moreLike?.tracks?.length ?? 0) > 0 && (
            <View>
              <SectionHeader
                title={`more like ${moreLike.seedTitle}`}
                sub="because you played it recently"
              />
              <RelatedRail
                tracks={moreLike.tracks}
                onPick={(_, i) => {
                  // The rail is the recommended set — queue it whole, start
                  // at the tapped tile.
                  player.playQueue(moreLike.tracks, i, 'more like this');
                  player.ui?.openPlayer?.();
                }}
                // Long-press a tile for its options (add to playlist/queue,
                // like, go to artist…) — the same track menu used everywhere.
                onLongPress={track => openTrackActions({ track })}
              />
            </View>
          )}

          {(topArtists?.length ?? 0) > 0 && (
            <View>
              <SectionHeader
                title="your top artists"
                sub="artists you play most"
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
                title="stations"
                sub={
                  reco?.stations && !explicitOff
                    ? 'radios from your artists'
                    : 'start from any song'
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
                title="made by you"
                sub="your playlists"
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
                title="made for you"
                sub="fresh editions from your plays — skips count"
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

          {(poolLoading || newPicks.length > 0) && (
            <View>
              <SectionHeader
                title="new for you"
                sub={newPicksPersonal ? 'from your listening' : 'fresh this week'}
              />
              {poolLoading ? (
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
              <SectionHeader title="popular playlists" sub="trending now" />
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    gap: 28,
    paddingTop: 14,
    paddingBottom: 24 + DOCK_CLEARANCE,
  },
  pad: { paddingHorizontal: 22, gap: 4 },
  greeting: { fontFamily: fonts.semibold, fontSize: 26 },
  tagline: { fontFamily: fonts.regular, fontSize: 13.5 },
  wheelWrap: { alignItems: 'center', paddingTop: 6 },
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
