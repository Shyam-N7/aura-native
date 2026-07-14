import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { DOCK_CLEARANCE } from '../components/nav/Dock';
import { usePlayer } from '../playback/PlayerContext';
import { searchCatalog } from '../api/catalog';
import { getUser } from '../lib/auth';
import { showToast } from '../lib/toast';
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

// Non-playable entity row (artists / albums) — Phase 1 has no artist or album
// pages, so pressing one says so honestly.
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
  const inputRef = useRef(null);

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [lang, setLang] = useState('all');
  const [hit, setHit] = useState(EMPTY);
  const recents = useRecentSearches();

  // The signed-in user's onboarding languages drive the filter pills and the
  // my-languages-first ranking hint sent with every query.
  const prefLangs = useMemo(() => getUser()?.seedLanguages ?? [], []);
  const pills = useMemo(() => ['all', ...prefLangs], [prefLangs]);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 350);
    return () => clearTimeout(id);
  }, [q]);

  // Pop the keyboard whenever the tab gains focus.
  useEffect(() => {
    if (!navigation?.addListener) {
      return undefined;
    }
    let timer;
    const unsub = navigation.addListener('focus', () => {
      timer = setTimeout(() => inputRef.current?.focus(), 120);
    });
    return () => {
      clearTimeout(timer);
      unsub();
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
        // Remember the query once something actually matched.
        if (d.songs.length || d.artists.length || d.albums.length) {
          pushRecentSearch(trimmed);
        }
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
  const nothing =
    !view.songs.length && !view.artists.length && !view.albums.length;

  const playSong = track => {
    // Web labels a direct search pick 'your pick' (auto-radio still continues
    // it at queue end and flips the source when the batch applies).
    player.playTrack(track, { source: 'your pick' });
    player.ui?.openPlayer?.();
  };

  return (
    <View
      style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TextInput
          ref={inputRef}
          value={q}
          onChangeText={setQ}
          placeholder="search songs, artists…"
          placeholderTextColor={t.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={[
            styles.input,
            { backgroundColor: t.surface, borderColor: t.line, color: t.ink },
          ]}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillRow}>
          {pills.map(L => {
            const on = lang === L;
            return (
              <Pressable
                key={L}
                accessibilityRole="button"
                accessibilityLabel={`language ${L}`}
                onPress={() => setLang(L)}
                style={[
                  styles.pill,
                  {
                    borderColor: on ? t.accent : t.line,
                    backgroundColor: on ? t.accentSoft : t.surface,
                  },
                ]}>
                <Text
                  style={[styles.pillText, { color: on ? t.accent : t.inkSoft }]}>
                  {L}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        style={styles.results}
        contentContainerStyle={styles.resultsInner}
        keyboardShouldPersistTaps="handled">
        {status === 'idle' && (
          <>
            {recents.items.length > 0 ? (
              <View>
                <View style={styles.recentHead}>
                  <Text style={[styles.section, { color: t.inkFaint }]}>
                    recent searches
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="clear recent searches"
                    onPress={recents.clear}
                    hitSlop={8}>
                    <Text style={[styles.clear, { color: t.accent }]}>
                      clear
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
                find songs, artists and albums from the catalog.
              </Text>
            )}
          </>
        )}

        {status === 'loading' && (
          <Text style={[styles.hint, { color: t.inkFaint }]}>searching…</Text>
        )}
        {status === 'error' && (
          <Text style={[styles.hint, { color: t.inkFaint }]}>
            search failed — {view.error}
          </Text>
        )}

        {status === 'ok' && (
          <>
            {nothing && (
              <Text style={[styles.hint, { color: t.inkFaint }]}>
                nothing matched “{trimmed}”.
              </Text>
            )}
            {view.songs.length > 0 && (
              <View>
                <Text style={[styles.section, { color: t.inkFaint }]}>
                  songs
                </Text>
                {view.songs.map(track => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    onPress={() => playSong(track)}
                  />
                ))}
              </View>
            )}
            {view.artists.length > 0 && (
              <View>
                <Text style={[styles.section, { color: t.inkFaint }]}>
                  artists
                </Text>
                {view.artists.map(a => (
                  <EntityRow
                    key={a.id}
                    image={a.image}
                    name={a.name}
                    sub="artist"
                    round
                    t={t}
                    onPress={() =>
                      showToast('artist pages come in the next build')
                    }
                  />
                ))}
              </View>
            )}
            {view.albums.length > 0 && (
              <View>
                <Text style={[styles.section, { color: t.inkFaint }]}>
                  albums
                </Text>
                {view.albums.map(a => (
                  <EntityRow
                    key={a.id}
                    image={a.image}
                    name={a.name}
                    sub={[a.isMovie ? 'movie' : 'album', a.year]
                      .filter(Boolean)
                      .join(' · ')}
                    t={t}
                    onPress={() =>
                      showToast('album pages come in the next build')
                    }
                  />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  pillRow: {
    gap: 8,
    paddingBottom: 2,
  },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 6,
  },
  pillText: {
    fontSize: 12.5,
  },
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
});
