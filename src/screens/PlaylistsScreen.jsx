import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BounceScrollView } from '../components/ui/Bounce';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import {
  listPlaylists,
  createPlaylist,
  deletePlaylist,
  removePlaylistCollaborator,
  listSavedPlaylists,
} from '../api/playlists';
import { listAutoPlaylists } from '../api/autoPlaylists';
import { getUser } from '../lib/auth';
import { relTime } from '../lib/time';
import { showToast } from '../lib/toast';
import { bumpHint, hintAvailable, killHint } from '../lib/tapHint';
import { CrumbBack } from '../components/detail/DetailChassis';
import { Icon } from '../components/Icon';
import { fonts, label, type } from '../theme/tokens';

// The playlists library, ported from web PlaylistsScreen: made-for-you mixes
// (read-only, full suite), made by you (+ create), shared with you, and
// saved-from-others — each group hidden when empty. The web's per-row
// anchored menu holds exactly one action (delete or leave), so native goes
// straight to the confirm from the ⋯ button.

// Why home sometimes shows fewer mixes than this screen: home windows the
// daypart mixes to their own local hours; here the full suite always shows,
// with these captions doing the explaining.
const DAYPART_NOTE = {
  morning: 'on home in the morning',
  night: 'on home after 8pm',
};

function Cover({ name, imageUrl, fallback }) {
  const { t } = useTheme();
  if (imageUrl) {
    return <Image source={{ uri: imageUrl }} style={styles.cover} />;
  }
  return (
    <View style={[styles.cover, styles.coverFallback, { backgroundColor: t.accentSoft }]}>
      <Text style={[styles.coverLetter, { color: t.accent }]}>
        {fallback ?? name?.[0]?.toUpperCase() ?? '·'}
      </Text>
    </View>
  );
}

function GroupHead({ text }) {
  const { t } = useTheme();
  return (
    <Text style={[label(9.5), styles.groupHead, { color: t.inkFaint }]}>
      {text}
    </Text>
  );
}

export default function PlaylistsScreen({ navigation }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const [hit, setHit] = useState({ data: null, error: null });
  const [auto, setAuto] = useState([]);
  const [savedLists, setSavedLists] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [hintOn] = useState(() => hintAvailable('newPlaylist'));
  const inputRef = useRef(null);
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';

  useEffect(() => {
    const ctl = new AbortController();
    listPlaylists({ signal: ctl.signal })
      .then(data => setHit({ data, error: null }))
      .catch(err => {
        if (err.name !== 'AbortError') {
          setHit({ data: null, error: err.message });
        }
      });
    return () => ctl.abort();
  }, []);

  // Smart sets from the user's listening (read-only). Best-effort: if it
  // fails or there's not enough history, the shelf just doesn't render.
  useEffect(() => {
    const ctl = new AbortController();
    listAutoPlaylists({ signal: ctl.signal })
      .then(setAuto)
      .catch(() => {});
    return () => ctl.abort();
  }, []);

  // Playlists you saved from someone else (best-effort; empty group hides).
  useEffect(() => {
    const ctl = new AbortController();
    listSavedPlaylists({ signal: ctl.signal })
      .then(setSavedLists)
      .catch(() => {});
    return () => ctl.abort();
  }, []);

  useEffect(() => {
    if (creating) {
      inputRef.current?.focus();
    }
  }, [creating]);

  useEffect(() => {
    if (hintOn) {
      bumpHint('newPlaylist');
    }
  }, [hintOn]);

  const submitNew = async () => {
    const name = newName.trim();
    if (!name) {
      setCreating(false);
      setNewName('');
      return;
    }
    try {
      const playlist = await createPlaylist({ name });
      setHit(h => ({ ...h, data: [playlist, ...(h.data ?? [])] }));
      showToast('playlist created.');
      setNewName('');
      setCreating(false);
    } catch (err) {
      showToast(`Couldn't create — ${err.message}`);
    }
  };

  const remove = playlist => {
    Alert.alert(
      `Delete "${playlist.name}"?`,
      "The playlist will be removed. Songs you've liked stay in your library.",
      [
        { text: 'cancel', style: 'cancel' },
        {
          text: 'delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePlaylist(playlist.id);
              setHit(h => ({
                ...h,
                data: (h.data ?? []).filter(p => p.id !== playlist.id),
              }));
              showToast('playlist deleted.');
            } catch (err) {
              showToast(`Couldn't delete — ${err.message}`);
            }
          },
        },
      ],
    );
  };

  // Collaborator leaving a shared playlist (owners use delete instead).
  const leave = playlist => {
    const me = getUser();
    if (!me?.id) {
      return;
    }
    Alert.alert(
      `Leave "${playlist.name}"?`,
      "You'll lose access until you're invited again.",
      [
        { text: 'cancel', style: 'cancel' },
        {
          text: 'leave',
          style: 'destructive',
          onPress: async () => {
            try {
              await removePlaylistCollaborator(playlist.id, me.id);
              setHit(h => ({
                ...h,
                data: (h.data ?? []).filter(p => p.id !== playlist.id),
              }));
              showToast('left the playlist.');
            } catch (err) {
              showToast(`Couldn't leave — ${err.message}`);
            }
          },
        },
      ],
    );
  };

  const lists = hit.data ?? [];
  // Sets YOU own (incl. a shared list you started) vs sets you were invited
  // into. The API returns one flat array; partition it for the headings.
  const owned = lists.filter(p => !p.shared || p.role === 'owner');
  const joined = lists.filter(p => p.shared && p.role !== 'owner');

  const openPlaylist = id => navigation.navigate('Playlist', { id });

  const renderRow = p => (
    <View key={p.id} style={styles.rowWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={p.name}
        onPress={() => openPlaylist(p.id)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <Cover name={p.name} imageUrl={p.coverImageUrl} />
        <View style={styles.rowMeta}>
          <Text numberOfLines={1} style={[styles.rowName, { color: t.ink }]}>
            {p.name}
          </Text>
          <Text numberOfLines={1} style={[label(8.5), { color: t.inkSoft }]}>
            {p.trackCount} {p.trackCount === 1 ? 'track' : 'tracks'}
            {p.shared &&
              ` · ${p.role === 'owner' ? 'shared' : 'shared with you'}`}
            {p.updatedAt ? ` · updated ${relTime(p.updatedAt)}` : ''}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={p.role === 'owner' ? `delete ${p.name}` : `leave ${p.name}`}
        onPress={() => (p.role === 'owner' ? remove(p) : leave(p))}
        hitSlop={8}
        style={({ pressed }) => [styles.more, pressed && styles.pressed]}
      >
        <Icon name="dots" size={17} color={t.inkFaint} />
      </Pressable>
    </View>
  );

  return (
    <View
      style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}
    >
      <BounceScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 24 },
        ]}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <CrumbBack onPress={() => navigation.goBack()} />
        <Text style={[label(9.5), { color: t.inkFaint }]}>your collection</Text>
        <Text style={[type.queueHero, { color: t.ink }]}>playlists</Text>

        {auto.length > 0 && (
          <>
            <GroupHead text="made for you" />
            {auto.map(a =>
              a.kind === 'auto-gate' ? (
                <View key={a.id} style={[styles.rowWrap, styles.gated]}>
                  <View style={styles.row}>
                    <Cover fallback="♫" />
                    <View style={styles.rowMeta}>
                      <Text
                        numberOfLines={1}
                        style={[styles.rowName, { color: t.ink }]}
                      >
                        {a.name}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[label(8.5), { color: t.inkSoft }]}
                      >
                        {a.gate?.line}
                      </Text>
                    </View>
                  </View>
                </View>
              ) : (
                <View key={a.id} style={styles.rowWrap}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={a.name}
                    onPress={() =>
                      navigation.navigate('CatalogPlaylist', {
                        id: a.id,
                        initialData: a,
                      })
                    }
                    style={({ pressed }) => [
                      styles.row,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Cover
                      name={a.name}
                      imageUrl={a.coverImageUrl}
                      fallback="♫"
                    />
                    <View style={styles.rowMeta}>
                      <Text
                        numberOfLines={1}
                        style={[styles.rowName, { color: t.ink }]}
                      >
                        {a.name}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[label(8.5), { color: t.inkSoft }]}
                      >
                        {(a.editionLabel ?? a.description) +
                          (a.cadence ? ` · ${a.cadence}` : '') +
                          (a.refreshing ? ' · refreshing…' : '') +
                          (DAYPART_NOTE[a.mixKey]
                            ? ` · ${DAYPART_NOTE[a.mixKey]}`
                            : '')}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`play ${a.name}`}
                    onPress={() => {
                      player.playQueue(a.tracks, 0, a.name);
                      player.ui?.openPlayer?.();
                    }}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.more,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Icon name="play" size={16} color={t.accent} />
                  </Pressable>
                </View>
              ),
            )}
          </>
        )}

        <GroupHead text="made by you" />
        {creating ? (
          <View style={[styles.create, { backgroundColor: t.surface }]}>
            <Text style={[label(9.5), { color: t.inkFaint }]}>
              Create a playlist
            </Text>
            <TextInput
              ref={inputRef}
              value={newName}
              onChangeText={setNewName}
              onSubmitEditing={submitNew}
              placeholder="Name your playlist"
              placeholderTextColor={t.inkFaint}
              style={[
                styles.input,
                { color: t.ink, borderColor: t.line, backgroundColor: t.bg },
              ]}
            />
            <View style={styles.createActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="cancel"
                onPress={() => {
                  setCreating(false);
                  setNewName('');
                }}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <Text style={[styles.createBtn, { color: t.inkSoft }]}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="create"
                disabled={!newName.trim()}
                onPress={submitNew}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <Text
                  style={[
                    styles.createBtn,
                    { color: newName.trim() ? t.accent : t.inkFaint },
                  ]}
                >
                  Create
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="new playlist"
              onPress={() => {
                killHint('newPlaylist');
                setCreating(true);
              }}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Cover fallback="+" />
              <Text style={[styles.rowName, { color: t.ink }]}>
                New playlist
              </Text>
            </Pressable>
            {hintOn && status === 'ok' && owned.length === 0 && (
              <Text style={[label(8), styles.hint, { color: t.accent }]}>
                start your first playlist
              </Text>
            )}
          </>
        )}

        {status === 'loading' && (
          <Text style={[styles.stateLine, { color: t.inkFaint }]}>
            Loading playlists
          </Text>
        )}
        {status === 'error' && (
          <Text style={[styles.stateLine, { color: t.inkSoft }]}>
            Couldn't fetch playlists — {hit.error}
          </Text>
        )}
        {status === 'ok' && owned.length === 0 && !creating && (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: t.ink }]}>
              nothing here yet.
            </Text>
            <Text style={[styles.emptyBody, { color: t.inkSoft }]}>
              tap "new playlist" above to start one.
            </Text>
          </View>
        )}
        {owned.map(renderRow)}

        {joined.length > 0 && (
          <>
            <GroupHead text="shared with you" />
            {joined.map(renderRow)}
          </>
        )}

        {savedLists.length > 0 && (
          <>
            <GroupHead text="saved" />
            {savedLists.map(p => (
              <View
                key={p.id}
                style={[styles.rowWrap, !p.accessible && styles.gated]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={p.accessible ? p.name : 'no longer shared'}
                  disabled={!p.accessible}
                  onPress={() => openPlaylist(p.id)}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && styles.pressed,
                  ]}
                >
                  <Cover
                    name={p.accessible ? p.name : null}
                    imageUrl={p.accessible ? p.coverImageUrl : null}
                  />
                  <View style={styles.rowMeta}>
                    <Text
                      numberOfLines={1}
                      style={[styles.rowName, { color: t.ink }]}
                    >
                      {p.accessible ? p.name : 'no longer shared'}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[label(8.5), { color: t.inkSoft }]}
                    >
                      {p.accessible
                        ? `${p.trackCount} ${
                            p.trackCount === 1 ? 'track' : 'tracks'
                          }${p.ownerName ? ` · by ${p.ownerName}` : ''}`
                        : 'the owner stopped sharing this'}
                    </Text>
                  </View>
                </Pressable>
              </View>
            ))}
          </>
        )}
      </BounceScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 10, gap: 7 },
  groupHead: { marginTop: 18, marginBottom: 2 },
  rowWrap: { flexDirection: 'row', alignItems: 'center' },
  gated: { opacity: 0.55 },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 7,
  },
  more: { paddingVertical: 10, paddingLeft: 8 },
  pressed: { opacity: 0.6 },
  cover: { width: 50, height: 50, borderRadius: 8 },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  coverLetter: { fontFamily: fonts.semibold, fontSize: 20 },
  rowMeta: { flex: 1, minWidth: 0, gap: 3 },
  rowName: { fontFamily: fonts.medium, fontSize: 15 },
  hint: { paddingLeft: 62, marginTop: -4 },
  stateLine: { fontFamily: fonts.regular, fontSize: 13.5, paddingVertical: 10 },
  empty: { paddingVertical: 14, gap: 4 },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 17 },
  emptyBody: { fontFamily: fonts.regular, fontSize: 13.5 },
  create: { borderRadius: 12, padding: 14, gap: 9 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: fonts.regular,
    fontSize: 15,
  },
  createActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 22,
    paddingVertical: 2,
  },
  createBtn: { fontFamily: fonts.medium, fontSize: 14.5 },
});
