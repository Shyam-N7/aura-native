import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppState,
  Image,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BounceScrollView } from '../components/ui/Bounce';
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
import { relTime } from '../lib/time';
import { showToast } from '../lib/toast';
import { storage } from '../storage/mmkv';
import { filterTracks, sortTracks } from '../lib/listFilter';
import {
  CrumbBack,
  PlayAllPill,
  CountLine,
  DetailRow,
} from '../components/detail/DetailChassis';
import { ListTools } from '../components/detail/ListTools';
import { Sheet } from '../components/ui/Sheet';
import { Avatar } from '../components/Avatar';
import { TrackArt } from '../components/TrackRow';
import { Icon } from '../components/Icon';
import { fonts, label, radii, type } from '../theme/tokens';
import { cleanTitle } from '../utils/title';

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

const SORT_KEY = 'aura.sortPlaylist';
const SORTS = [
  { id: 'default', label: 'in order' },
  { id: 'title', label: 'title' },
  { id: 'artist', label: 'artist' },
  { id: 'longest', label: 'longest' },
];

const POLL_MS = 15000;

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
  // screen is open and the app is foregrounded, refetch on change.
  useEffect(() => {
    if (!shared || publicId) {
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
  }, [id, publicId, shared, updatedAt]);

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
    Alert.alert(
      'Make this only you?',
      `${bits.join(', ')}. You can share it again anytime.`,
      [
        { text: 'cancel', style: 'cancel' },
        {
          text: 'make private',
          style: 'destructive',
          onPress: async () => {
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
          },
        },
      ],
    );
  };

  // Owner removes a collaborator from the members sheet (with a confirm).
  const dropCollaborator = c => {
    Alert.alert(
      `Remove ${c.name}?`,
      'They lose access to this playlist. You can re-invite them anytime.',
      [
        { text: 'cancel', style: 'cancel' },
        {
          text: 'remove',
          style: 'destructive',
          onPress: async () => {
            const prev = hit.data;
            setHit(h => ({
              ...h,
              data: {
                ...h.data,
                collaborators: h.data.collaborators.filter(
                  x => x.userId !== c.userId,
                ),
              },
            }));
            try {
              await removePlaylistCollaborator(id, c.userId);
              showToast(`Removed ${c.name}.`);
            } catch (err) {
              setHit({ data: prev, error: null });
              showToast(`Couldn't remove — ${err.message}`);
            }
          },
        },
      ],
    );
  };

  const removeTrack = track => {
    Alert.alert(
      `Remove "${cleanTitle(track.title)}"?`,
      'This only removes it from this playlist. Your likes are untouched.',
      [
        { text: 'cancel', style: 'cancel' },
        {
          text: 'remove',
          style: 'destructive',
          onPress: async () => {
            const prev = hit.data;
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
          },
        },
      ],
    );
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
  const playFrom = i => {
    player.playQueue(shown, i, (hit.data?.name ?? 'this playlist').toLowerCase());
    player.ui?.openPlayer?.();
  };

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

        {status === 'loading' && (
          <Text style={[styles.stateLine, { color: t.inkFaint }]}>
            Loading playlist
          </Text>
        )}
        {status === 'error' && (
          <Text style={[styles.stateLine, { color: t.inkSoft }]}>
            This playlist is private or unavailable. If someone shared it, ask
            them for a public view link.
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
                <View style={styles.list}>
                  {shown.map((track, i) => (
                    <DetailRow
                      key={track.id}
                      track={track}
                      index={i}
                      highlight={query}
                      reason={
                        shared && track.addedBy
                          ? `added by ${
                              track.addedBy.userId === myId
                                ? 'you'
                                : track.addedBy.name
                            }`
                          : undefined
                      }
                      onPress={() => playFrom(i)}
                      menu={{
                        extras: canEdit
                          ? [
                              {
                                label: 'remove from this playlist',
                                danger: true,
                                onPress: () => removeTrack(track),
                              },
                            ]
                          : [],
                      }}
                    />
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </BounceScrollView>

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

      {/* Cover picker — any track's art can be the cover. (Uploading a custom
          image needs a native picker — deferred; the web path stays.) */}
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
          <View style={styles.coverGrid}>
            {tracks.map(track => (
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
  content: { paddingHorizontal: 20, paddingTop: 10, gap: 7 },
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
  list: { marginTop: 8 },
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
});
