import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BounceScrollView } from '../components/ui/Bounce';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { getUser, getActiveExplicitOff } from '../lib/auth';
import { showToast } from '../lib/toast';
import { homeCache } from '../lib/homeCache';
import { dropExplicit } from '../lib/explicit';
import { getQuickPicks } from '../api/quickPicks';
import { getMostPlayed, getTopArtists, getRecentlyPlayed } from '../api/stats';
import { listPlaylists } from '../api/playlists';
import { listAutoPlaylists } from '../api/autoPlaylists';
import { getDiscoverHome } from '../api/discover';
import { getRelated } from '../api/related';
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

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) {
    return 'good morning';
  }
  if (hour < 17) {
    return 'good afternoon';
  }
  return 'good evening';
}

// Cache-first section fetch (web homeCache contract): state seeds
// synchronously from the cache so tab returns render fully without a cascade;
// the fetch runs only when the key is absent. Failures resolve to [] without
// caching, so a later visit retries. null = not loaded yet.
function useHomeSection(key, fetcher) {
  const [data, setData] = useState(() => homeCache[key] ?? null);
  useEffect(() => {
    if (homeCache[key] !== undefined) {
      return undefined;
    }
    let stale = false;
    fetcher()
      .then(d => {
        homeCache[key] = d;
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
    () => homeCache.autoPlaylists ?? null,
  );
  useEffect(() => {
    let stale = false;
    listAutoPlaylists()
      .then(p => {
        homeCache.autoPlaylists = p;
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

  // "More like {your newest listen}" — the same related-tracks engine that
  // picks the radio, surfaced as a browsable shelf (field ask: more real
  // recommendations on home). Seeded by the latest history entry; cached with
  // the seed so returning to Home is instant and a NEW listen re-seeds it.
  const moreLikeSeed = recent?.[0] ?? null;
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
  const hero = pool.tracks[0] ?? null;
  const newPicks = pool.tracks.slice(1, 5);
  const stations = pool.tracks.slice(5, 9);

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
              {greeting()}
              {firstName ? `, ${firstName}` : ''}
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
            loading={poolLoading}
            onBegin={() => hero && pickFromPool(hero)}
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
              <SectionHeader title="stations" sub="start from any song" />
              <StationsGrid
                stations={stations}
                loading={poolLoading}
                onPick={pickFromPool}
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
              <SectionHeader title="new for you" sub="fresh this week" />
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
                  onPressItem={item => pickFromPool(item.track)}
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
