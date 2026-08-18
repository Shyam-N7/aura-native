import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BounceScrollView } from '../components/ui/Bounce';
import { AuraLoader } from '../components/ui/AuraLoader';
import { ErrorState } from '../components/ui/ErrorState';
import { DOCK_CLEARANCE } from '../components/nav/Dock';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import {
  listPlaylists,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  removePlaylistCollaborator,
  listSavedPlaylists,
} from '../api/playlists';
import { listAutoPlaylists } from '../api/autoPlaylists';
import { getFeatures } from '../api/ytImport';
import { COPY as YT_COPY } from '../lib/ytImportCopy';
import { getUser } from '../lib/auth';
import { relTime } from '../lib/time';
import { showToast } from '../lib/toast';
import { bumpHint, hintAvailable, killHint } from '../lib/tapHint';
import { CrumbBack } from '../components/detail/DetailChassis';
import { ConfirmPopup } from '../components/ui/ConfirmPopup';
import { Rule } from '../components/ui/Rule';
import { SheetRow } from '../components/ui/SheetRow';
import { Icon } from '../components/Icon';
import { usePullRefresh } from '../hooks/usePullRefresh';
import { fonts, label, radii, type } from '../theme/tokens';

// The playlists library, ported from web PlaylistsScreen: made-for-you mixes
// (read-only, full suite), made by you (+ create), shared with you, and
// saved-from-others — each group hidden when empty.
//
// The ⋯ menu is a POPUP, not a sheet. The first cut shipped it as a bottom
// sheet per the older anchored-menu-becomes-a-sheet convention, and the user
// pushed back — pointing at the direction they had already set once before:
// ConfirmPopup exists because they specified "popup, not sheet" for the
// background-play switch, and PickerPopup is its sibling. This menu joins that
// family, and carries the row's details (cover, name, counts) as its header —
// the popup IS the playlist details card, with actions under it.

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
  const [hintOn, setHintOn] = useState(() => hintAvailable('newPlaylist'));
  // The playlist whose ⋯ menu is open, or null. The menu exists so that the
  // dots do what dots promise: field report was "tapped 3 dots, clicked
  // delete, no confirmation" — the dots went STRAIGHT to the confirm sheet,
  // which therefore read as an options menu, and its red "delete" pill read as
  // choosing an action rather than answering a question. The confirmation
  // existed in code and was invisible in experience. Menu first, question
  // second: two steps, each reading as itself.
  const [menuFor, setMenuFor] = useState(null);
  const [ytOn, setYtOn] = useState(false);
  const inputRef = useRef(null);
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';

  // Returns its promise, and takes the same `quiet` mode every list screen's
  // load does: a pull-to-refresh re-runs THIS request rather than a second
  // copy of it, and a failure re-throws instead of replacing the shelves that
  // are already on screen with an error line.
  const reload = useCallback((signal, { quiet = false } = {}) => {
    return listPlaylists({ signal })
      .then(data => setHit({ data, error: null }))
      .catch(err => {
        if (err.name === 'AbortError') {
          return;
        }
        if (quiet) {
          throw err;
        }
        setHit({ data: null, error: err.message });
      });
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    reload(ctl.signal);
    return () => ctl.abort();
  }, [reload]);

  // The error state's way out. The reset to `loading` lives here rather than
  // inside reload() because the focus refetch below deliberately re-runs
  // against a list that is already on screen — it must not blink the loader.
  const retry = useCallback(() => {
    setHit({ data: null, error: null });
    reload();
  }, [reload]);

  // Pull-to-refresh. This screen is four independent fetches wearing one
  // page, so the pull re-runs all three that can change (the YouTube feature
  // flag is deployment state, not data). The two shelves stay best-effort
  // exactly as their own effects are — a mixes shelf that fails to reload is
  // still a shelf, and only the playlists themselves are worth a sentence.
  const pull = usePullRefresh(signal =>
    Promise.all([
      reload(signal, { quiet: true }),
      listAutoPlaylists({ signal })
        .then(setAuto)
        .catch(() => {}),
      listSavedPlaylists({ signal })
        .then(setSavedLists)
        .catch(() => {}),
    ]),
  );

  // Refetch when the screen is focused again. The stack keeps parked screens
  // MOUNTED (see hooks/useNavFocused), so coming back from a finished import
  // would otherwise show the list exactly as it was — without the playlist the
  // import just created, which reads as an import that failed.
  useEffect(() => {
    let first = true;
    return navigation.addListener('focus', () => {
      if (first) {
        first = false;
        return;
      }
      reload();
    });
  }, [navigation, reload]);

  // Whether this deployment has the YouTube key set. A button that leads to a
  // 503 is worse than no button, so a failed lookup means no entry point —
  // getFeatures never throws and answers {} when it cannot tell.
  useEffect(() => {
    let alive = true;
    getFeatures().then(f => {
      if (alive) {
        setYtOn(!!f.youtubeImport);
      }
    });
    return () => {
      alive = false;
    };
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
      showToast('Playlist created.');
      setNewName('');
      setCreating(false);
    } catch (err) {
      showToast(`Couldn't create — ${err.message}`);
    }
  };

  // The destructive question, asked by ConfirmPopup rather than the global
  // confirm sheet: the menu that leads here is a popup, and a question that
  // rises as a sheet after a popup reads as two different apps. `confirmFor`
  // holds { playlist, kind: 'delete' | 'leave' } while the question is open.
  const [confirmFor, setConfirmFor] = useState(null);

  const remove = async playlist => {
    try {
      await deletePlaylist(playlist.id);
      setHit(h => ({
        ...h,
        data: (h.data ?? []).filter(p => p.id !== playlist.id),
      }));
      showToast('Playlist deleted.');
    } catch (err) {
      showToast(`Couldn't delete — ${err.message}`);
    }
  };

  // Collaborator leaving a shared playlist (owners use delete instead).
  const leave = async playlist => {
    const me = getUser();
    if (!me?.id) {
      return;
    }
    try {
      await removePlaylistCollaborator(playlist.id, me.id);
      setHit(h => ({
        ...h,
        data: (h.data ?? []).filter(p => p.id !== playlist.id),
      }));
      showToast('Left the playlist.');
    } catch (err) {
      showToast(`Couldn't leave — ${err.message}`);
    }
  };

  // "play" from the ⋯ popup: the list row carries no tracks, so fetch the
  // playlist first — the detail screen's own play-all path, one tap earlier.
  const [playBusy, setPlayBusy] = useState(false);
  const playFromMenu = async playlist => {
    if (playBusy) {
      return;
    }
    setPlayBusy(true);
    try {
      const full = await getPlaylist(playlist.id);
      const tracks = full?.tracks ?? [];
      if (!tracks.length) {
        showToast('Nothing to play yet.');
        return;
      }
      setMenuFor(null);
      player.playQueue(tracks, 0, playlist.name);
      player.ui?.openPlayer?.();
    } catch (err) {
      showToast(`Couldn't play — ${err.message}`);
    } finally {
      setPlayBusy(false);
    }
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
        accessibilityLabel={`${p.name} options`}
        onPress={() => setMenuFor(p)}
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
          { paddingBottom: insets.bottom + DOCK_CLEARANCE },
        ]}
        refreshControl={pull.control}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <CrumbBack onPress={() => navigation.goBack()} />
        <Text style={[label(9.5), { color: t.inkFaint }]}>your collection</Text>
        <Text style={[type.queueHero, { color: t.ink }]}>playlists</Text>

        {auto.length > 0 && (
          <>
            <GroupHead text="Made for you" />
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

        <GroupHead text="Made by you" />
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
              cursorColor={t.accent}
              selectionColor={t.accent}
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
                hitSlop={10}
                style={({ pressed }) => [styles.createHit, pressed && styles.pressed]}
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
                hitSlop={10}
                style={({ pressed }) => [styles.createHit, pressed && styles.pressed]}
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
                setHintOn(false);
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
                Start your first playlist
              </Text>
            )}
            {/* The one gate that decides whether this feature exists for a
                user. On web the equivalent edit was the piece that got missed,
                and the refresh button sat built-and-unreachable for four PRs. */}
            {ytOn && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={YT_COPY.entry.label}
                onPress={() => navigation.navigate('YouTubeImport')}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <Cover fallback="▶" />
                <View style={styles.rowMeta}>
                  <Text
                    numberOfLines={1}
                    style={[styles.rowName, { color: t.ink }]}
                  >
                    {YT_COPY.entry.label}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[label(8.5), { color: t.inkSoft }]}
                  >
                    {YT_COPY.entry.hint}
                  </Text>
                </View>
              </Pressable>
            )}
          </>
        )}

        {status === 'loading' && <AuraLoader label="Loading playlists" />}
        {status === 'error' && (
          <ErrorState
            style={styles.errorBlock}
            message={`Couldn't load — ${hit.error}`}
            onRetry={retry}
          />
        )}
        {status === 'ok' && owned.length === 0 && !creating && (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: t.ink }]}>
              Nothing here yet.
            </Text>
            <Text style={[styles.emptyBody, { color: t.inkSoft }]}>
              Tap "new playlist" above to start one.
            </Text>
          </View>
        )}
        {owned.map(renderRow)}

        {joined.length > 0 && (
          <>
            <GroupHead text="Shared with you" />
            {joined.map(renderRow)}
          </>
        )}

        {savedLists.length > 0 && (
          <>
            <GroupHead text="Saved" />
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
                      {p.accessible ? p.name : 'No longer shared'}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[label(8.5), { color: t.inkSoft }]}
                    >
                      {p.accessible
                        ? `${p.trackCount} ${
                            p.trackCount === 1 ? 'track' : 'tracks'
                          }${p.ownerName ? ` · by ${p.ownerName}` : ''}`
                        : 'The owner stopped sharing this'}
                    </Text>
                  </View>
                </Pressable>
              </View>
            ))}
          </>
        )}
      </BounceScrollView>

      {/* The ⋯ menu: a popup carrying the playlist's details as its header,
          with the actions under it. The destructive row still only ASKS — the
          question is a second step, in the same popup family. */}
      {menuFor && (
        <MenuPopup
          playlist={menuFor}
          playBusy={playBusy}
          onClose={() => setMenuFor(null)}
          onOpen={() => {
            const p = menuFor;
            setMenuFor(null);
            openPlaylist(p.id);
          }}
          onPlay={() => playFromMenu(menuFor)}
          onShare={
            !menuFor.shared || menuFor.role === 'owner'
              ? () => {
                  const p = menuFor;
                  setMenuFor(null);
                  // The visibility controls live on the detail screen; the
                  // `share` param asks it to open them on arrival.
                  navigation.navigate('Playlist', { id: p.id, share: true });
                }
              : null
          }
          onDanger={() => {
            const p = menuFor;
            const kind = !p.shared || p.role === 'owner' ? 'delete' : 'leave';
            // Close before asking, so the question is not stacked on the menu.
            setMenuFor(null);
            setConfirmFor({ playlist: p, kind });
          }}
        />
      )}

      <ConfirmPopup
        visible={!!confirmFor}
        danger
        title={
          confirmFor?.kind === 'leave'
            ? `Leave "${confirmFor?.playlist.name}"?`
            : `Delete "${confirmFor?.playlist.name}"?`
        }
        body={
          confirmFor?.kind === 'leave'
            ? "You'll lose access until you're invited again."
            : "The playlist will be removed. Songs you've liked stay in your library."
        }
        action={confirmFor?.kind === 'leave' ? 'Leave' : 'Delete'}
        onCancel={() => setConfirmFor(null)}
        onConfirm={() => {
          const target = confirmFor;
          setConfirmFor(null);
          if (!target) {
            return;
          }
          if (target.kind === 'leave') {
            leave(target.playlist);
          } else {
            remove(target.playlist);
          }
        }}
      />
    </View>
  );
}

// The ⋯ popup: the playlist's identity as the header — cover, name, the same
// meta line the list row wears — then the actions. ConfirmPopup's sibling in
// every way that matters: plain RN Modal fade (no reanimated entering; the
// documented 4.2.3/Fabric abort class), scrim cancels, card swallows taps.
function MenuPopup({ playlist: p, playBusy, onClose, onOpen, onPlay, onShare, onDanger }) {
  const { t } = useTheme();
  const owned = !p.shared || p.role === 'owner';
  return (
    <Modal
      transparent
      statusBarTranslucent
      visible
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.menuScrim}
        onPress={onClose}
        accessibilityLabel="dismiss"
      >
        <Pressable
          style={[styles.menuCard, { backgroundColor: t.surface, borderColor: t.line }]}
          onPress={() => {}}
        >
          <View style={styles.menuHead}>
            <Cover name={p.name} imageUrl={p.coverImageUrl} />
            <View style={styles.rowMeta}>
              <Text numberOfLines={1} style={[styles.rowName, { color: t.ink }]}>
                {p.name}
              </Text>
              <Text numberOfLines={2} style={[label(8.5), { color: t.inkSoft }]}>
                {p.trackCount} {p.trackCount === 1 ? 'track' : 'tracks'}
                {p.shared && ` · ${owned ? 'shared' : 'shared with you'}`}
                {p.updatedAt ? ` · updated ${relTime(p.updatedAt)}` : ''}
              </Text>
            </View>
          </View>

          <Rule style={styles.menuRule} />

          <SheetRow icon="play" label={playBusy ? 'Starting…' : 'Play'} disabled={playBusy} onPress={onPlay} />
          <SheetRow icon="arrow-right" label="Open playlist" onPress={onOpen} />
          {onShare && <SheetRow icon="people" label="Who can see this" onPress={onShare} />}
          <SheetRow
            icon="close"
            danger
            label={owned ? 'Delete playlist' : 'Leave playlist'}
            onPress={onDanger}
          />
        </Pressable>
      </Pressable>
    </Modal>
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
  cover: { width: 50, height: 50, borderRadius: radii.coverMd },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  coverLetter: { fontFamily: fonts.semibold, fontSize: 20 },
  rowMeta: { flex: 1, minWidth: 0, gap: 3 },
  rowName: type.rowTitle,
  hint: { paddingLeft: 62, marginTop: -4 },
  errorBlock: { paddingVertical: 10 },
  empty: { paddingVertical: 14, gap: 4 },
  emptyTitle: type.blockTitle,
  emptyBody: type.caption,
  menuScrim: {
    flex: 1,
    // The popup family's one scrim + one radius — the same pair ConfirmPopup
    // and PickerPopup wear, so a menu and the question it leads to are
    // visibly the same kind of surface.
    backgroundColor: 'rgba(10, 8, 6, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  menuCard: {
    alignSelf: 'stretch',
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 2,
  },
  menuHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 12 },
  menuRule: { marginBottom: 6 },
  create: { borderRadius: radii.card, padding: 14, gap: 9 },
  input: {
    borderWidth: 1,
    borderRadius: radii.input,
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
  // ~17dp of text is not a button. Padding grows the touch box and the equal
  // negative margin returns the space, so the create row keeps its height:
  // 17 + 20 padding + 20 hitSlop = 57dp.
  createHit: { paddingVertical: 10, marginVertical: -10 },
  createBtn: { fontFamily: fonts.medium, fontSize: 14.5 },
});
