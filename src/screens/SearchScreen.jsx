import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BounceScrollView } from '../components/ui/Bounce';
import { AuraLoader } from '../components/ui/AuraLoader';
import { useTheme } from '../theme/ThemeContext';
import { fonts, label } from '../theme/tokens';
import { TOPBAR_CLEARANCE } from '../components/nav/TopBar';
import { DOCK_CLEARANCE } from '../components/nav/Dock';
import { usePlayer } from '../playback/PlayerContext';
import { searchCatalog } from '../api/catalog';
import { LANGUAGES } from '../data/languages';
import { getUser, getActiveExplicitOff } from '../lib/auth';
import { dropExplicit } from '../lib/explicit';
import {
  closeSearch,
  openSearch,
  subscribeSearchSubmit,
  useSearchQuery,
} from '../lib/searchQuery';
import { TrackRow, TrackArt } from '../components/TrackRow';
import {
  useRecentSearches,
  pushRecentSearch,
} from '../hooks/useRecentSearches';

const EMPTY = {
  key: '',
  top: null,
  songs: [],
  artists: [],
  albums: [],
  playlists: [],
  userPlaylists: [],
  error: null,
};

// Filter pills: 'all' + the full canonical catalog list (web DesktopSearch
// parity — the user's own languages are a ranking hint, not the pill source).
const LANGS = ['all', ...LANGUAGES];
// The picked language survives screen unmount for the session — web parity
// (searchCache.js keeps it in a module-scope var, not storage).
let lastLang = 'all';

// Pre-query trending chips, ported verbatim from web SearchSidebar: a
// hardcoded in-bundle list per language (no endpoint exists — it changes
// only on deploy); unlisted languages fall back to 'all'.
const TRENDING_BY_LANG = {
  all: ['halcyon', 'a.r. rahman', 'sid sriram', 'lana del rey', 'arijit singh', 'phir bhi tumko chaahunga'],
  tamil: ['vaaranam aayiram', 'anirudh', 'sid sriram', 'thalapathy', 'jana nayagan', 'ar rahman tamil'],
  english: ['halcyon', 'lana del rey', 'hozier', 'ellie goulding', 'taylor swift', 'phoebe bridgers'],
  hindi: ['arijit singh', 'ar rahman hindi', 'pritam', 'lata mangeshkar', 'tu hi hai aashiqui', 'kal ho na ho'],
  malayalam: ['malayalam hits', 'shaan rahman', 'gopi sundar', 'sushin shyam', 'malayalam classics', 'kj yesudas'],
  kannada: ['kannada hits', 'raghu dixit', 'arjun janya', 'sanjith hegde', 'sonu nigam kannada', 'k.j. yesudas'],
};

// Entity row (artist / album / playlist tile).
function EntityRow({ image, name, sub, round, onPress, t }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      onPress={onPress}
      style={({ pressed }) => [styles.entityRow, pressed && styles.pressed]}>
      <TrackArt track={{ imageUrl: image, name }} size={48} round={round} />
      <View style={styles.entityMeta}>
        <Text numberOfLines={1} style={[styles.entityName, { color: t.ink }]}>
          {name}
        </Text>
        <Text style={[styles.entitySub, { color: t.inkSoft }]}>{sub}</Text>
      </View>
    </Pressable>
  );
}

export default function SearchScreen({ navigation }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  // The single floating top bar (TopBarHost) is this screen's input surface —
  // the query rides the shared bus its field writes to, and the bar itself
  // owns dropping field focus when the player opens.
  const { query: q, setQuery: setQ } = useSearchQuery();
  const [debouncedQ, setDebouncedQ] = useState('');
  const [lang, setLang] = useState(lastLang);
  const [hit, setHit] = useState(EMPTY);
  const recents = useRecentSearches();

  // The signed-in user's onboarding languages drive the my-languages-first
  // ranking hint sent with every query (the pills offer every language).
  const prefLangs = useMemo(() => getUser()?.seedLanguages ?? [], []);

  const pickLang = L => {
    setLang(L);
    lastLang = L;
  };

  // 600ms: long enough that slow typists (field report: "mar… and… hu")
  // don't fire a query at every breath, short enough that search still feels
  // live once you stop typing.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 600);
    return () => clearTimeout(id);
  }, [q]);

  // This tab IS the morphed search field: landing here (the dock's search
  // icon, or the top bar's chip from elsewhere) opens the shared morph so the
  // floating bar shows the field instead of its resting brand/mode/theme
  // layer; leaving closes it again — same blur-clears-state shape as
  // HomeScreen's scrollDepth listener.
  useEffect(() => {
    if (!navigation?.addListener) {
      return undefined;
    }
    // Tab entry presents the field settled — the morph is the chip tap's
    // theatre; replayed on every tab switch it read as a white flash with a
    // ghosted double-exposure mid-frame (owner report).
    const offFocus = navigation.addListener('focus', () =>
      openSearch({ instant: true }),
    );
    const offBlur = navigation.addListener('blur', closeSearch);
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation]);

  const trimmed = debouncedQ.trim();
  const wantKey = `${trimmed}|${lang}`;

  useEffect(() => {
    if (!trimmed) {
      return undefined;
    }
    let stale = false;
    searchCatalog(trimmed, {
      lang: lang === 'all' ? undefined : lang,
      langs: prefLangs,
      limit: 12,
    })
      .then(d => {
        if (stale) {
          return;
        }
        setHit({ key: wantKey, ...d, error: null });
      })
      .catch(err => {
        if (!stale) {
          setHit({ ...EMPTY, key: wantKey, error: err.message });
        }
      });
    return () => {
      stale = true;
    };
  }, [trimmed, lang, wantKey, prefLangs]);

  const view = hit.key === wantKey ? hit : EMPTY;
  const status = !trimmed
    ? 'idle'
    : view.error
      ? 'error'
      : view.key === wantKey
        ? 'ok'
        : 'loading';
  // Family mode filters the songs section client-side (web dropExplicit);
  // other sections carry no per-track flag.
  const songs = dropExplicit(view.songs, getActiveExplicitOff());
  const nothing =
    !songs.length &&
    !view.artists.length &&
    !view.albums.length &&
    !view.playlists.length &&
    !view.userPlaylists.length &&
    !view.top;

  // Recents record on COMMIT only — tapping a result or pressing the
  // keyboard's search key — never on the auto-fired as-you-type queries.
  // (Field report: slow typing left "mar", "marand", "marandhu" as three
  // recents on the way to "marandhu poche".)
  const remember = useCallback(() => {
    if (trimmed) {
      pushRecentSearch(trimmed);
    }
  }, [trimmed]);

  // The keyboard's search key commits from the single top bar's field — the
  // submit travels the bus (the bar has no per-screen props anymore).
  useEffect(() => subscribeSearchSubmit(remember), [remember]);

  const playSong = track => {
    remember();
    // The top bar drops the field's focus itself when the player opens (the
    // ROM's lingering keyboard inset); the early dismiss here just starts
    // the keyboard down a frame sooner.
    Keyboard.dismiss();
    // Web labels a direct search pick 'your pick' (auto-radio still continues
    // it at queue end and flips the source when the batch applies).
    player.playTrack(track, { source: 'your pick' });
    player.ui?.openPlayer?.();
  };

  // Tile taps route by entity type; a song top-result is suppressed (the
  // songs list leads instead, web parity).
  const openTop = top => {
    remember();
    if (top.type === 'artist') {
      navigation.navigate('Artist', { id: top.id, name: top.name });
    } else if (top.type === 'album') {
      navigation.navigate('Album', { id: top.id });
    } else if (top.type === 'playlist') {
      navigation.navigate('CatalogPlaylist', { id: top.id });
    }
  };
  const trending = TRENDING_BY_LANG[lang] ?? TRENDING_BY_LANG.all;
  // Album-hero queries lead with albums (web section-order swap).
  const albumsFirst = view.top?.type === 'album';

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <View
        style={[styles.header, { paddingTop: insets.top + TOPBAR_CLEARANCE }]}>
        <ScrollView overScrollMode="always"
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillRow}>
          {LANGS.map(L => {
            const on = lang === L;
            return (
              <Pressable
                key={L}
                accessibilityRole="button"
                accessibilityLabel={`language ${L}`}
                onPress={() => pickLang(L)}
                style={[
                  styles.pill,
                  on
                    ? { borderColor: t.accent, backgroundColor: t.accent }
                    : { borderColor: t.line },
                ]}>
                <Text style={[styles.pillText, { color: on ? t.bg : t.inkSoft }]}>
                  {L}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <BounceScrollView
        style={styles.results}
        contentContainerStyle={styles.resultsInner}
        keyboardShouldPersistTaps="handled">
        {status === 'idle' && (
          <>
            {recents.items.length > 0 ? (
              <View>
                <View style={styles.recentHead}>
                  <Text style={[styles.section, { color: t.inkFaint }]}>
                    Recent searches
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="clear recent searches"
                    onPress={recents.clear}
                    hitSlop={8}>
                    <Text style={[styles.clear, { color: t.accent }]}>
                      Clear
                    </Text>
                  </Pressable>
                </View>
                {recents.items.map(item => (
                  <Pressable
                    key={item}
                    accessibilityRole="button"
                    accessibilityLabel={`search ${item}`}
                    onPress={() => setQ(item)}
                    style={({ pressed }) => [
                      styles.recentRow,
                      pressed && styles.pressed,
                    ]}>
                    <Text style={[styles.recentText, { color: t.ink }]}>
                      {item}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text style={[styles.hint, { color: t.inkFaint }]}>
                Find songs, artists and albums from the catalog.
              </Text>
            )}
            <View>
              <Text style={[styles.section, { color: t.inkFaint }]}>
                Trending{lang !== 'all' ? ` · ${lang}` : ''}
              </Text>
              <View style={styles.chips}>
                {trending.map(item => (
                  <Pressable
                    key={item}
                    accessibilityRole="button"
                    accessibilityLabel={`search ${item}`}
                    onPress={() => setQ(item)}
                    style={({ pressed }) => [
                      styles.chip,
                      { borderColor: t.line },
                      pressed && styles.pressed,
                    ]}>
                    <Text style={[styles.chipText, { color: t.ink }]}>
                      {item}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </>
        )}

        {status === 'loading' && <AuraLoader label="Searching" />}
        {status === 'error' && (
          <Text style={[styles.hint, { color: t.inkFaint }]}>
            Search failed — {view.error}
          </Text>
        )}

        {status === 'ok' &&
          (() => {
            const songsSection = songs.length > 0 && (
              <View key="songs">
                <Text style={[styles.section, { color: t.inkFaint }]}>
                  Songs
                </Text>
                {songs.map(track => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    onPress={() => playSong(track)}
                    menu={{}}
                  />
                ))}
              </View>
            );
            const artistsSection = view.artists.length > 0 && (
              <View key="artists">
                <Text style={[styles.section, { color: t.inkFaint }]}>
                  Artists
                </Text>
                {view.artists.map(a => (
                  <EntityRow
                    key={a.id}
                    image={a.image}
                    name={a.name}
                    sub="Artist"
                    round
                    t={t}
                    onPress={() => {
                      remember();
                      navigation.navigate('Artist', { id: a.id, name: a.name });
                    }}
                  />
                ))}
              </View>
            );
            const albumsSection = view.albums.length > 0 && (
              <View key="albums">
                <Text style={[styles.section, { color: t.inkFaint }]}>
                  Albums & movies
                </Text>
                {view.albums.map(a => (
                  <EntityRow
                    key={a.id}
                    image={a.image}
                    name={a.name}
                    sub={[a.isMovie ? 'Movie' : 'Album', a.year]
                      .filter(Boolean)
                      .join(' · ')}
                    t={t}
                    onPress={() => {
                      remember();
                      navigation.navigate('Album', { id: a.id });
                    }}
                  />
                ))}
              </View>
            );
            return (
              <>
                {nothing && (
                  <Text style={[styles.hint, { color: t.inkFaint }]}>
                    Nothing matched “{trimmed}”.
                  </Text>
                )}
                {view.top && view.top.type !== 'song' && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`open ${view.top.name}`}
                    onPress={() => openTop(view.top)}
                    style={({ pressed }) => [
                      styles.hero,
                      { backgroundColor: t.surface },
                      pressed && styles.pressed,
                    ]}>
                    <TrackArt
                      track={{ imageUrl: view.top.image, name: view.top.name }}
                      size={68}
                      radius={10}
                      round={view.top.type === 'artist'}
                    />
                    <View style={styles.entityMeta}>
                      <Text
                        numberOfLines={1}
                        style={[styles.heroName, { color: t.ink }]}>
                        {view.top.name}
                      </Text>
                      <Text style={[styles.entitySub, { color: t.inkSoft }]}>
                        {view.top.type === 'album'
                          ? view.top.isMovie
                            ? 'Movie'
                            : 'Album'
                          : view.top.type}
                      </Text>
                    </View>
                  </Pressable>
                )}
                {albumsFirst
                  ? [albumsSection, songsSection, artistsSection]
                  : [songsSection, artistsSection, albumsSection]}
                {view.playlists.length > 0 && (
                  <View>
                    <Text style={[styles.section, { color: t.inkFaint }]}>
                      Playlists
                    </Text>
                    {view.playlists.map(p => (
                      <EntityRow
                        key={p.id}
                        image={p.image}
                        name={p.name}
                        sub={(p.subtitle ?? 'playlist').toLowerCase()}
                        t={t}
                        onPress={() => {
                          remember();
                          navigation.navigate('CatalogPlaylist', { id: p.id });
                        }}
                      />
                    ))}
                  </View>
                )}
                {view.userPlaylists.length > 0 && (
                  <View>
                    <Text style={[styles.section, { color: t.inkFaint }]}>
                      Your playlists
                    </Text>
                    {view.userPlaylists.map(p => (
                      <EntityRow
                        key={p.id}
                        image={p.coverImageUrl}
                        name={p.name}
                        sub={`${p.trackCount} ${
                          p.trackCount === 1 ? 'track' : 'tracks'
                        }`}
                        t={t}
                        onPress={() => {
                          remember();
                          navigation.navigate('Playlist', { id: p.id });
                        }}
                      />
                    ))}
                  </View>
                )}
              </>
            );
          })()}
      </BounceScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    gap: 10,
  },
  pillRow: {
    gap: 8,
    paddingBottom: 2,
  },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  // label(11) spelled out — same four properties, 11 * 0.08 = 0.88.
  pillText: label(11),
  results: {
    flex: 1,
  },
  resultsInner: {
    paddingHorizontal: 16,
    paddingTop: 10,
    // Content scrolls under the floating glass dock.
    paddingBottom: 24 + DOCK_CLEARANCE,
    gap: 14,
  },
  section: {
    fontSize: 11,
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  hint: {
    fontSize: 13.5,
    marginTop: 12,
  },
  recentHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  clear: {
    fontSize: 12.5,
  },
  recentRow: {
    paddingVertical: 9,
  },
  recentText: {
    fontSize: 14.5,
  },
  pressed: {
    opacity: 0.6,
  },
  entityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 7,
  },
  entityMeta: {
    flex: 1,
    gap: 2,
  },
  entityName: {
    fontSize: 15,
    fontWeight: '500',
  },
  entitySub: {
    fontSize: 12.5,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 4,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  chipText: {
    fontSize: 12.5,
    fontFamily: fonts.regular,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 14,
    padding: 14,
  },
  heroName: {
    fontFamily: fonts.semibold,
    fontSize: 19,
    letterSpacing: -0.1,
  },
});
