import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Image,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { BounceFlatList } from '../components/ui/Bounce';
import { LONG_LIST } from '../lib/listWindow';
import { AuraLoader } from '../components/ui/AuraLoader';
import { DOCK_CLEARANCE } from '../components/nav/Dock';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import {
  getPlaylist,
  getPublicPlaylist,
  removeFromPlaylist,
  getPlaylistRev,
  createPlaylistInvite,
  setPlaylistVisibility,
  setPlaylistOnlyMe,
  setPlaylistCover,
  removePlaylistCollaborator,
  savePlaylist,
  unsavePlaylist,
} from '../api/playlists';
import { API_BASE, getUser } from '../lib/auth';
import { uploadImage } from '../api/uploads';
import { pickImage } from '../lib/imagePicker';
import { relTime } from '../lib/time';
import { showToast } from '../lib/toast';
import { confirm } from '../lib/confirm';
import { storage } from '../storage/mmkv';
import { filterTracks, sortTracks } from '../lib/listFilter';
import {
  CrumbBack,
  PlayAllPill,
  CountLine,
  DetailRow,
} from '../components/detail/DetailChassis';
import { ListTools } from '../components/detail/ListTools';
import { PLAYLIST_SORT_KEY, PLAYLIST_SORTS } from '../components/detail/listSorts';
import { Sheet } from '../components/ui/Sheet';
import { Avatar } from '../components/Avatar';
import { TrackArt } from '../components/TrackRow';
import { Icon } from '../components/Icon';
import { fonts, label, radii, type } from '../theme/tokens';
import { cleanTitle } from '../utils/title';
import { useBackToTop } from '../hooks/useBackToTop';
import { countRender } from '../lib/renderCount';

// Your (or a shared) playlist, ported from web DesktopPlaylistDetail: cover +
// hero + who-can-see-this share chip, collaborator cluster with a members
// sheet, added-by lines, remove-from-playlist, and a rev-poll that keeps a
// shared playlist live while the screen is open. Also serves the read-only
// PUBLIC view (route param `publicId`) with save-to-library.
// Native adaptations: the web's clipboard copies become the system share
// sheet (which carries its own copy action); the anchored visibility menu
// and dialogs become bottom sheets; custom cover UPLOAD is deferred (needs a
// native image picker) — the pick-from-tracks path is complete.

// A playlist is in exactly one of three visible states, worn as the share
// chip's icon + label so the owner always sees who can see it (public wins
// when both a link and collaborators exist — web parity).
const VIS_ICON = { private: 'lock', shared: 'people', public: 'globe' };
const VIS_LABEL = { private: 'private', shared: 'shared', public: 'public' };

// Shared with CatalogPlaylistScreen — same key, so necessarily the same list.
const SORT_KEY = PLAYLIST_SORT_KEY;
const SORTS = PLAYLIST_SORTS;

const POLL_MS = 15000;

// Nothing inline reaches a row. DetailRow is React.memo'd, and a fresh closure
// (`onPress={() => playFrom(i)}`), a fresh object (the `menu={{extras: …}}`
// literal) or a renderItem redefined in the render body each defeats that
// compare on its own. Same shape as LikedScreen.
const ROW_MENU = { extras: [] };

const PlaylistTrackRow = React.memo(function PlaylistTrackRow({
  track,
  index,
  highlight,
  reason,
  onPlay,
  onRemove,
}) {
  const press = useCallback(() => onPlay(index), [onPlay, index]);
  const menu = useMemo(
    () =>
      onRemove
        ? {
            extras: [
              {
                label: 'remove from this playlist',
                danger: true,
                onPress: () => onRemove(track),
              },
            ],
          }
        : ROW_MENU,
    [onRemove, track],
  );
  return (
    <DetailRow
      track={track}
      index={index}
      highlight={highlight}
      reason={reason}
      onPress={press}
      menu={menu}
    />
  );
});

function SheetItem({ icon, text, note, on, disabled, onPress }) {
  const { t } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={disabled ? { disabled: true } : {}}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.sheetItem, pressed && styles.pressed]}
    >
      {icon ? (
        <Icon name={icon} size={18} color={on ? t.accent : t.inkSoft} />
      ) : (
        <View style={styles.sheetIconGap} />
      )}
      <View style={styles.sheetItemMeta}>
        <Text
          style={[
            styles.sheetItemText,
            { color: disabled ? t.inkFaint : on ? t.accent : t.ink },
          ]}
        >
          {text}
        </Text>
        {!!note && (
          <Text style={[styles.sheetItemNote, { color: t.inkSoft }]}>
            {note}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function SheetHead({ text }) {
  const { t } = useTheme();
  return (
    <Text style={[label(9.5), styles.sheetHead, { color: t.inkFaint }]}>
      {text}
    </Text>
  );
}

export default function PlaylistScreen({ route, navigation }) {
  // __DEV__-only; stripped from release (lib/renderCount).
  countRender('PlaylistScreen');
  const backToTop = useBackToTop();
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const { id = null, publicId = null } = route.params ?? {};
  const [hit, setHit] = useState({ data: null, error: null });
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [coverPicking, setCoverPicking] = useState(false);
  const [saved, setSaved] = useState(false);
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';

  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(
    () => storage.getItem(SORT_KEY) ?? 'default',
  );
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input), 150);
    return () => clearTimeout(timer);
  }, [input]);
  const pickSort = sortId => {
    setSort(sortId);
    storage.setItem(SORT_KEY, sortId);
  };

  const load = useCallback(
    signal =>
      (publicId
        ? getPublicPlaylist(publicId, { signal })
        : getPlaylist(id, { signal })
      )
        .then(data => setHit({ data, error: null }))
        .catch(err => {
          if (err.name !== 'AbortError') {
            setHit({ data: null, error: err.message });
          }
        }),
    [id, publicId],
  );

  useEffect(() => {
    const ctl = new AbortController();
    load(ctl.signal);
    return () => ctl.abort();
  }, [load]);

  const tracks = useMemo(() => hit.data?.tracks ?? [], [hit.data]);
  const shown = useMemo(
    () => sortTracks(filterTracks(tracks, query), sort),
    [tracks, query, sort],
  );
  const hitRef = useRef(hit);
  hitRef.current = hit;

  const myId = getUser()?.id;
  const canEdit = !publicId && (hit.data?.canEdit ?? false);
  const isOwner = !publicId && hit.data?.role === 'owner';
  const shared = hit.data?.shared ?? false;
  const collaborators = hit.data?.collaborators ?? [];
  const collabCaption =
    collaborators.length === 1
      ? `${collaborators[0].name} · can ${
          collaborators[0].role === 'viewer' ? 'view' : 'edit'
        }`
      : `${collaborators
          .slice(0, 2)
          .map(c => c.name)
          .join(', ')}${
          collaborators.length > 2 ? ` +${collaborators.length - 2} more` : ''
        }`;
  const updatedAt = hit.data?.updatedAt;
  const isPublic = hit.data?.isPublic ?? false;
  const pubId = hit.data?.publicId ?? null;
  const coverImageUrl = hit.data?.coverImageUrl ?? null;
  const visibility = isPublic
    ? 'public'
    : collaborators.length
    ? 'shared'
    : 'private';

  // Live sync for shared playlists — poll the cheap rev cursor while the
  // screen is open, FOCUSED and the app is foregrounded, refetch on change.
  // Without the focus gate, a shared playlist left in the nav stack keeps
  // polling for the rest of the session.
  const focused = useIsFocused();
  useEffect(() => {
    if (!shared || publicId || !focused) {
      return undefined;
    }
    let stop = false;
    const tick = async () => {
      if (stop || AppState.currentState !== 'active') {
        return;
      }
      try {
        const { updatedAt: rev } = await getPlaylistRev(id);
        if (stop || !rev || rev === updatedAt) {
          return;
        }
        const data = await getPlaylist(id);
        if (!stop) {
          setHit({ data, error: null });
        }
      } catch {
        /* transient — next tick retries */
      }
    };
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [id, publicId, shared, updatedAt, focused]);

  // ── Share flows (system share sheet; it carries its own copy action) ──
  const shareLink = async (link, title) => {
    try {
      await Share.share({ title, message: link });
    } catch {
      /* user dismissed */
    }
  };
  const shareInvite = role => async () => {
    setShareOpen(false);
    try {
      const { token } = await createPlaylistInvite(id, role ? { role } : {});
      await shareLink(
        `${API_BASE}/playlists?join=${token}`,
        hit.data?.name ?? 'playlist',
      );
    } catch (err) {
      showToast(`Couldn't create a link — ${err.message}`);
    }
  };
  const togglePublic = async () => {
    if (shareBusy) {
      return;
    }
    setShareBusy(true);
    try {
      const { isPublic: nowPublic, publicId: pid } =
        await setPlaylistVisibility(id, !isPublic);
      setHit(h => ({
        ...h,
        data: { ...h.data, isPublic: nowPublic, publicId: pid },
      }));
      if (nowPublic) {
        setShareOpen(false);
        await shareLink(`${API_BASE}/p/${pid}`, hit.data?.name ?? 'playlist');
      } else {
        showToast('Public link is off.');
      }
    } catch (err) {
      showToast(`Couldn't update — ${err.message}`);
    } finally {
      setShareBusy(false);
    }
  };
  const sharePublicLink = () => {
    setShareOpen(false);
    shareLink(`${API_BASE}/p/${pubId}`, hit.data?.name ?? 'playlist');
  };

  // "Only you" — the hard-private revert. Spell out exactly what it severs.
  const makeOnlyMe = () => {
    setShareOpen(false);
    const bits = [];
    if (collaborators.length) {
      bits.push(
        `${collaborators.length} ${
          collaborators.length === 1 ? 'collaborator' : 'collaborators'
        } lose access`,
      );
    }
    bits.push('any pending invite links stop working');
    if (isPublic) {
      bits.push('the public link turns off');
    }
    confirm({
      title: 'make this only you?',
      body: `${bits.join(', ')}. you can share it again anytime.`,
      action: 'make private',
    }).then(async ok => {
      if (!ok) {
        return;
      }
      const prev = hit.data;
      setHit(h => ({
        ...h,
        data: {
          ...h.data,
          collaborators: [],
          isPublic: false,
          shared: false,
        },
      }));
      try {
        await setPlaylistOnlyMe(id);
        showToast('Only you can see this now.');
      } catch (err) {
        setHit({ data: prev, error: null });
        showToast(`Couldn't update — ${err.message}`);
      }
    });
  };

  // Owner removes a collaborator from the members sheet (with a confirm).
  const dropCollaborator = async c => {
    const ok = await confirm({
      title: `remove ${c.name}?`,
      body: 'they lose access to this playlist. you can re-invite them anytime.',
      action: 'remove',
    });
    if (!ok) {
      return;
    }
    const prev = hit.data;
    setHit(h => ({
      ...h,
      data: {
        ...h.data,
        collaborators: h.data.collaborators.filter(x => x.userId !== c.userId),
      },
    }));
    try {
      await removePlaylistCollaborator(id, c.userId);
      showToast(`Removed ${c.name}.`);
    } catch (err) {
      setHit({ data: prev, error: null });
      showToast(`Couldn't remove — ${err.message}`);
    }
  };

  const removeTrack = useCallback(async track => {
    const ok = await confirm({
      title: `remove "${cleanTitle(track.title)}"?`,
      body: 'this only removes it from this playlist. your likes are untouched.',
      action: 'remove',
    });
    if (!ok) {
      return;
    }
    const prev = hitRef.current.data;
    setHit(h => ({
      ...h,
      data: {
        ...h.data,
        tracks: h.data.tracks.filter(x => x.id !== track.id),
        trackCount: (h.data.trackCount ?? 1) - 1,
      },
    }));
    try {
      await removeFromPlaylist(id, track.id);
      showToast('Removed.');
    } catch (err) {
      setHit({ data: prev, error: null });
      showToast(`Couldn't remove — ${err.message}`);
    }
    // `id` is the only value this needs to keep stable across renders; the
    // rollback snapshot comes off hitRef so a data change does not hand every
    // mounted row a new menu.
  }, [id]);

  // Upload a custom cover image (picker delivers it pre-resized).
  const uploadCover = async () => {
    try {
      const asset = await pickImage('cover');
      if (!asset) {
        return;
      }
      setCoverPicking(false);
      showToast('Uploading cover…');
      const { url } = await uploadImage(asset, { kind: 'cover' });
      const { coverImageUrl: next } = await setPlaylistCover(id, {
        imageUrl: url,
      });
      setHit(h => ({ ...h, data: { ...h.data, coverImageUrl: next } }));
      showToast('Cover updated.');
    } catch (err) {
      showToast(`Couldn't upload — ${err.message}`);
    }
  };

  // Set the cover to a chosen track's art (owner/editor). Optimistic.
  const chooseCover = async track => {
    setCoverPicking(false);
    const prev = hit.data;
    setHit(h => ({
      ...h,
      data: { ...h.data, coverImageUrl: track.imageUrl ?? h.data.coverImageUrl },
    }));
    try {
      await setPlaylistCover(id, { trackId: track.id });
      showToast('Cover updated.');
    } catch (err) {
      setHit({ data: prev, error: null });
      showToast(`Couldn't set cover — ${err.message}`);
    }
  };

  // Public view: keep someone else's playlist without editing it.
  const toggleSave = async () => {
    try {
      if (saved) {
        await unsavePlaylist(hit.data.id);
        setSaved(false);
        showToast('Removed from your playlists.');
      } else {
        const r = await savePlaylist(hit.data.id);
        if (r?.own) {
          showToast('This one is already yours.');
        } else {
          setSaved(true);
          showToast('Saved to your playlists.');
        }
      }
    } catch (err) {
      showToast(err.message);
    }
  };

  // Play what's on screen: a filtered or re-sorted view queues in that order.
  //
  // shownRef / playerRef rather than deps: both change on things that must not
  // reach the rows — `shown` on every keystroke, the player value on every
  // track advance — and this only ever runs on a tap, so it must read the
  // CURRENT values without taking a new identity when they move.
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const playerRef = useRef(player);
  playerRef.current = player;
  const source = (hit.data?.name ?? 'this playlist').toLowerCase();
  const playFrom = useCallback(
    i => {
      playerRef.current.playQueue(shownRef.current, i, source);
      playerRef.current.ui?.openPlayer?.();
    },
    [source],
  );

  // Rows are windowed FlatList data — a shared playlist can be hundreds of
  // tracks, and mounting them all on open (the old ScrollView map) was the
  // measured OOM-kill spike. Everything above the rows rides as the header.
  const renderRow = useCallback(
    ({ item: track, index: i }) => (
      <PlaylistTrackRow
        track={track}
        index={i}
        highlight={query}
        reason={
          shared && track.addedBy
            ? `added by ${
                track.addedBy.userId === myId ? 'you' : track.addedBy.name
              }`
            : undefined
        }
        onPlay={playFrom}
        onRemove={canEdit ? removeTrack : null}
      />
    ),
    [query, shared, myId, playFrom, canEdit, removeTrack],
  );

  return (
    <View
      style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}
    >
      <BounceFlatList
        {...backToTop}
        data={status === 'ok' ? shown : []}
        renderItem={renderRow}
        keyExtractor={item => item.id}
        {...LONG_LIST}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + DOCK_CLEARANCE },
        ]}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.head}>
            <CrumbBack onPress={() => navigation.goBack()} />

        {status === 'loading' && <AuraLoader label="loading playlist" />}
        {status === 'error' && (
          <Text style={[styles.stateLine, { color: t.inkSoft }]}>
            {/* This was one fixed sentence for both branches, so opening YOUR
                OWN playlist while offline told you it was private and to ask
                a friend for a share link. The caught message was already in
                state and simply never rendered — every sibling screen shows
                it. Lowercase per docs/CONTEXT.md's stated voice. */}
            {publicId
              ? 'this playlist is private or unavailable. if someone shared it, ask them for a public view link.'
              : hit.error || "couldn't load this playlist."}
          </Text>
        )}

        {status === 'ok' && (
          <>
            <View style={[styles.cover, { backgroundColor: t.accentSoft }]}>
              {coverImageUrl ? (
                <Image
                  source={{ uri: coverImageUrl }}
                  style={styles.coverImg}
                />
              ) : (
                <Text style={[styles.coverFallback, { color: t.accent }]}>
                  {hit.data.name?.[0]?.toUpperCase() ?? '♪'}
                </Text>
              )}
              {canEdit && tracks.length > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="change cover"
                  onPress={() => setCoverPicking(true)}
                  style={({ pressed }) => [
                    styles.coverEdit,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[label(8.5), styles.coverEditText]}>
                    change cover
                  </Text>
                </Pressable>
              )}
            </View>
            <Text style={[label(9.5), { color: t.inkFaint }]}>
              playlist{shared ? ' · shared' : ''}
            </Text>
            <Text style={[type.queueHero, { color: t.ink }]}>
              {hit.data.name}
            </Text>
            <Text style={[label(9.5), { color: t.inkSoft }]}>
              {isOwner ? 'by you' : `by ${hit.data.ownerName ?? 'someone'}`}
              {updatedAt ? ` · updated ${relTime(updatedAt)}` : ''}
            </Text>

            {collaborators.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="who has access"
                onPress={() => setMembersOpen(true)}
                style={({ pressed }) => [
                  styles.collabs,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.cluster}>
                  {collaborators.slice(0, 5).map(c => (
                    <View key={c.userId} style={styles.clusterAv}>
                      <Avatar user={c} size={26} />
                    </View>
                  ))}
                  {collaborators.length > 5 && (
                    <View
                      style={[
                        styles.clusterAv,
                        styles.clusterMore,
                        { backgroundColor: t.accentSoft },
                      ]}
                    >
                      <Text style={[label(8), { color: t.accent }]}>
                        +{collaborators.length - 5}
                      </Text>
                    </View>
                  )}
                </View>
                <Text
                  numberOfLines={1}
                  style={[label(8.5), styles.clusterCap, { color: t.inkSoft }]}
                >
                  {collabCaption}
                </Text>
              </Pressable>
            )}

            <View style={styles.actions}>
              {tracks.length > 0 && (
                <PlayAllPill text="Play all" onPress={() => playFrom(0)} />
              )}
              {isOwner && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${VIS_LABEL[visibility]} — change who can see this`}
                  onPress={() => setShareOpen(true)}
                  style={({ pressed }) => [
                    styles.visChip,
                    { borderColor: t.line },
                    visibility !== 'private' && {
                      borderColor: t.accent,
                      backgroundColor: t.accentSoft,
                    },
                    pressed && styles.pressed,
                  ]}
                >
                  <Icon
                    name={VIS_ICON[visibility]}
                    size={14}
                    color={visibility === 'private' ? t.inkSoft : t.accent}
                  />
                  <Text
                    style={[
                      label(9.5),
                      {
                        color: visibility === 'private' ? t.inkSoft : t.accent,
                      },
                    ]}
                  >
                    {VIS_LABEL[visibility]}
                  </Text>
                </Pressable>
              )}
              {!!publicId && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    saved ? 'remove from your playlists' : 'save to your playlists'
                  }
                  onPress={toggleSave}
                  style={({ pressed }) => [
                    styles.visChip,
                    { borderColor: saved ? t.accent : t.line },
                    saved && { backgroundColor: t.accentSoft },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[label(9.5), { color: saved ? t.accent : t.inkSoft }]}
                  >
                    {saved ? 'saved' : 'save'}
                  </Text>
                </Pressable>
              )}
            </View>

            {tracks.length === 0 && (
              <View style={styles.empty}>
                <Text style={[styles.emptyTitle, { color: t.ink }]}>
                  No tracks yet.
                </Text>
                <Text style={[styles.emptyBody, { color: t.inkSoft }]}>
                  Add songs from any song's menu.
                </Text>
              </View>
            )}

            {tracks.length > 0 && (
              <>
                <CountLine tracks={tracks} />
                <ListTools
                  query={input}
                  onQuery={setInput}
                  sort={sort}
                  onSort={pickSort}
                  sorts={SORTS}
                />
                {query.trim() !== '' && shown.length === 0 && (
                  <Text style={[styles.stateLine, { color: t.inkSoft }]}>
                    No matches for "{query.trim()}".
                  </Text>
                )}
              </>
            )}
          </>
        )}
          </View>
        }
      />

      {/* Who can see this — the web's anchored share menu as a sheet. */}
      {shareOpen && (
        <Sheet onClose={() => setShareOpen(false)} closeLabel="close sharing">
          <SheetHead text="who can see this" />
          <SheetItem
            icon="lock"
            text="only you"
            note="just for you"
            on={visibility === 'private'}
            disabled={visibility === 'private'}
            onPress={makeOnlyMe}
          />
          <SheetHead
            text={`people you invite${collaborators.length ? ' ·' : ''}`}
          />
          <SheetItem
            icon="people"
            text="share an edit-invite link"
            note="they can add and remove songs after signing in"
            onPress={shareInvite('editor')}
          />
          <SheetItem
            icon="people"
            text="share a view-invite link"
            note="they can listen after signing in"
            onPress={shareInvite('viewer')}
          />
          <SheetHead text={`anyone with the link${isPublic ? ' ·' : ''}`} />
          <SheetItem
            icon="globe"
            text={isPublic ? 'turn off public link' : 'make a public view link'}
            on={isPublic}
            disabled={shareBusy}
            onPress={togglePublic}
          />
          {isPublic && !!pubId && (
            <SheetItem
              icon="globe"
              text="share public link"
              onPress={sharePublicLink}
            />
          )}
        </Sheet>
      )}

      {/* Members sheet — who has access: the owner + every collaborator,
          their role and when they joined; the owner can remove someone. */}
      {membersOpen && (
        <Sheet
          onClose={() => setMembersOpen(false)}
          closeLabel="close members"
          header={
            <Text style={[styles.sheetTitle, { color: t.ink }]}>
              who has access
            </Text>
          }
        >
          <View style={styles.member}>
            <Avatar
              user={{
                name: hit.data?.ownerName,
                avatarUrl: hit.data?.ownerAvatarUrl,
              }}
              size={38}
            />
            <View style={styles.memberMeta}>
              <Text style={[styles.memberName, { color: t.ink }]}>
                {isOwner ? 'you' : hit.data?.ownerName ?? 'someone'}
              </Text>
              <Text style={[label(8.5), { color: t.inkSoft }]}>owner</Text>
            </View>
          </View>
          {collaborators.map(c => (
            <View key={c.userId} style={styles.member}>
              <Avatar user={c} size={38} />
              <View style={styles.memberMeta}>
                <Text style={[styles.memberName, { color: t.ink }]}>
                  {c.userId === myId ? 'you' : c.name}
                </Text>
                <Text style={[label(8.5), { color: t.inkSoft }]}>
                  can {c.role === 'viewer' ? 'view' : 'edit'}
                  {c.joinedAt ? ` · joined ${relTime(c.joinedAt)}` : ''}
                </Text>
              </View>
              {isOwner && c.userId !== myId && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`remove ${c.name}`}
                  onPress={() => dropCollaborator(c)}
                  hitSlop={8}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <Text style={[label(9.5), { color: t.accent }]}>remove</Text>
                </Pressable>
              )}
            </View>
          ))}
        </Sheet>
      )}

      {/* Cover picker — upload your own image, or any track's art. */}
      {coverPicking && (
        <Sheet
          onClose={() => setCoverPicking(false)}
          closeLabel="close cover picker"
          header={
            <Text style={[styles.sheetTitle, { color: t.ink }]}>
              choose a cover
            </Text>
          }
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="upload your own image"
            onPress={uploadCover}
            style={({ pressed }) => [
              styles.uploadRow,
              { borderColor: t.line },
              pressed && styles.pressed,
            ]}
          >
            <Icon name="plus" size={16} color={t.accent} />
            <Text style={[styles.sheetItemText, { color: t.accent }]}>
              upload your own image
            </Text>
          </Pressable>
          <Text style={[label(9.5), styles.sheetHead, { color: t.inkFaint }]}>
            or pick from this playlist
          </Text>
          <View style={styles.coverGrid}>
            {/* A sample is plenty for picking a cover — the full playlist
                would mount hundreds of 76px tiles inside this sheet. */}
            {tracks.slice(0, 24).map(track => (
              <Pressable
                key={track.id}
                accessibilityRole="button"
                accessibilityLabel={`cover ${cleanTitle(track.title)}`}
                onPress={() => chooseCover(track)}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <TrackArt track={track} size={76} radius={radii.coverMd} />
              </Pressable>
            ))}
          </View>
        </Sheet>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 10 },
  // The old content gap, now scoped to the header block so it can't leak
  // 7px seams between the windowed rows; marginBottom keeps the old
  // ListTools→first-row breathing room (styles.list's marginTop).
  head: { gap: 7, marginBottom: 8 },
  stateLine: { fontFamily: fonts.regular, fontSize: 13.5, marginTop: 12 },
  cover: {
    width: 148,
    height: 148,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    overflow: 'hidden',
  },
  coverImg: { width: '100%', height: '100%' },
  coverFallback: { fontFamily: fonts.semibold, fontSize: 52 },
  coverEdit: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(20,16,12,0.55)',
    paddingVertical: 5,
    alignItems: 'center',
  },
  coverEditText: { color: '#f4ece0' },
  collabs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 2,
  },
  cluster: { flexDirection: 'row', alignItems: 'center' },
  clusterAv: { marginRight: -8 },
  clusterMore: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clusterCap: { flex: 1, marginLeft: 12 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
  },
  visChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginTop: 10,
  },
  empty: { marginTop: 18, gap: 5 },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 17 },
  emptyBody: { fontFamily: fonts.regular, fontSize: 13.5 },
  pressed: { opacity: 0.6 },
  sheetTitle: { fontFamily: fonts.semibold, fontSize: 18 },
  sheetHead: { marginTop: 12, marginBottom: 2 },
  sheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 11,
  },
  sheetIconGap: { width: 18 },
  sheetItemMeta: { flex: 1, minWidth: 0, gap: 2 },
  sheetItemText: { fontFamily: fonts.medium, fontSize: 15 },
  sheetItemNote: { fontFamily: fonts.regular, fontSize: 12 },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
  },
  memberMeta: { flex: 1, minWidth: 0, gap: 2 },
  memberName: { fontFamily: fonts.medium, fontSize: 15 },
  coverGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingVertical: 10,
  },
  uploadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginTop: 4,
  },
});
