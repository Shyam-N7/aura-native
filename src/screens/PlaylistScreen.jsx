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
import { ROW_LAYOUT, RowArrive } from '../components/ui/RowArrive';
import { AuraLoader } from '../components/ui/AuraLoader';
import { ErrorState } from '../components/ui/ErrorState';
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
import { getFeatures, getYtLink, refreshPlaylist } from '../api/ytImport';
import { getSeedRadio } from '../api/autoPlaylists';
import { useImportJob } from '../hooks/useImportJob';
import { COPY as YT_COPY, copyForCode } from '../lib/ytImportCopy';
import { YouTubeReview } from '../overlays/YouTubeReview';
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
import { SheetRow } from '../components/ui/SheetRow';
import { Avatar } from '../components/Avatar';
import { TrackArt } from '../components/TrackRow';
import { Icon } from '../components/Icon';
import { fonts, label, radii, type } from '../theme/tokens';
import { cleanTitle } from '../utils/title';
import { useBackToTop } from '../hooks/useBackToTop';
import { usePullRefresh } from '../hooks/usePullRefresh';
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
const VIS_LABEL = { private: 'Private', shared: 'Shared', public: 'Public' };

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
                icon: 'close',
                label: 'Remove from this playlist',
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
  const { t, name: themeName } = useTheme();
  // The "change cover" strip rides a fixed dark scrim over the cover art, so
  // its label has to stay LIGHT in every theme — that's `surface` on the two
  // light themes and `ink` on midnight (was dusk's #f4ece0 pasted flat).
  const onScrimInk = themeName === 'midnight' ? t.ink : t.surface;
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const { id = null, publicId = null, share = false, importJobId = null } =
    route.params ?? {};
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

  // `quiet` is the pull-to-refresh mode of the SAME request every other caller
  // uses: a failure re-throws instead of writing the error state, so a
  // playlist that is already on screen is never traded for an error page
  // because the network blinked. usePullRefresh says the sentence.
  const load = useCallback(
    (signal, { quiet = false } = {}) =>
      (publicId
        ? getPublicPlaylist(publicId, { signal })
        : getPlaylist(id, { signal })
      )
        .then(data => setHit({ data, error: null }))
        .catch(err => {
          if (err.name === 'AbortError') {
            return;
          }
          if (quiet) {
            throw err;
          }
          setHit({ data: null, error: err.message });
        }),
    [id, publicId],
  );

  useEffect(() => {
    const ctl = new AbortController();
    load(ctl.signal);
    return () => ctl.abort();
  }, [load]);

  // Pull-to-refresh, named `pull` because `refreshing` on this screen already
  // means the YouTube re-check below — a different thing entirely (that one
  // asks YouTube for new songs, this one re-reads the playlist we have). Both
  // can run at once and neither touches the other's state.
  const pull = usePullRefresh(signal => load(signal, { quiet: true }));

  // The error state's way out. The reset to `loading` lives here, not inside
  // load(): every other caller (the import/refresh re-reads below) re-runs it
  // against rows that are already on screen and must not blink the loader.
  const retry = useCallback(() => {
    setHit({ data: null, error: null });
    load();
  }, [load]);

  // Arrived via "who can see this" in the playlists-list popup: open the
  // share controls once the data is here. One-shot — the param must not
  // reopen the sheet every time the data refreshes.
  const sharedOnArrival = useRef(false);
  useEffect(() => {
    if (share && !sharedOnArrival.current && hit.data && !publicId) {
      sharedOnArrival.current = true;
      setShareOpen(true);
    }
  }, [share, hit.data, publicId]);

  // ── Check YouTube for new songs ───────────────────────────────────
  //
  // Gated on the deployment having the key AND on this playlist having a stored
  // source row. The second is the real gate: the server writes a link row only
  // for a FINITE playlist, never for a mix — a mix regenerates every time
  // YouTube builds it, so there is nothing stable to diff against. "No row" and
  // "not refreshable" are the same statement, so no kind check is needed here.
  // Both lookups are session-cached and neither throws; a failure means no
  // chip, which is the right way to fail — a button that 503s is worse than no
  // button.
  const [ytLink, setYtLink] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const {
    job: refreshJob,
    setJob: setRefreshJob,
    live: refreshLive,
    stalled: jobStalled,
    resume: jobResume,
  } = useImportJob(null);

  // ── The streaming tail ─────────────────────────────────────────────
  //
  // Arrived via the import screen's handoff: the playlist already exists and
  // the server is still matching. The SAME hook instance that serves the
  // refresh flow takes the job over (one poller per screen — and since the
  // poll is the worker, this screen is now what drives the import). The seed
  // is a bare {id, status} — the hook polls immediately for those. Consumed
  // once: setParams clears it so a remount does not re-adopt a finished job.
  const importOriginRef = useRef(false);
  const seededRef = useRef(false);
  useEffect(() => {
    if (importJobId && !seededRef.current) {
      seededRef.current = true;
      importOriginRef.current = true;
      setRefreshJob({ id: importJobId, status: 'matching' });
      navigation.setParams({ importJobId: undefined });
    }
  }, [importJobId, setRefreshJob, navigation]);

  const streaming = refreshLive && !publicId;

  // Every poll that lands new songs refetches the playlist — full replace via
  // the same setHit path everything else uses; 'default' sort preserves the
  // server's order, so appended songs land at the bottom, which is where the
  // footer says they will.
  const jobAuto = refreshJob?.counts?.auto ?? 0;
  const jobTotal = refreshJob?.counts?.total ?? 0;
  useEffect(() => {
    if (!refreshLive || !hitRef.current.data) {
      return;
    }
    load();
  }, [jobAuto, jobTotal, refreshLive, load]);

  // How many rows existed before the latest batch — rows past this index get
  // the arrival rise-in. A ref, deliberately one render behind: by the time
  // the new data paints, prevLenRef still holds the OLD length, which is
  // exactly the boundary the animation needs.
  const prevLenRef = useRef(0);

  useEffect(() => {
    // A public view of someone else's playlist has nothing to refresh.
    if (publicId) {
      return undefined;
    }
    let alive = true;
    getFeatures()
      .then(f => (f.youtubeImport ? getYtLink(id) : null))
      .then(link => {
        if (alive) {
          setYtLink(link ?? null);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, publicId]);

  // The refresh finished. Reuse `load` rather than writing a second fetch — it
  // already handles both the owned and public shapes.
  useEffect(() => {
    if (!refreshJob || refreshLive) {
      return;
    }
    load();
    // A REFRESH announces its result — the user asked a question and the
    // toast is the answer. A streamed import ends in place: the footer
    // settles and the review chip (if any) takes over; a toast on top of
    // that would be the same news twice.
    if (!importOriginRef.current) {
      showToast(YT_COPY.refresh.added(refreshJob.counts?.auto ?? 0));
    }
  }, [refreshJob, refreshLive, load]);

  const checkForNewSongs = async () => {
    setRefreshing(true);
    try {
      const result = await refreshPlaylist(id);
      if (!result.changed) {
        showToast(YT_COPY.refresh.unchanged);
        return;
      }
      setRefreshJob(result);
    } catch (err) {
      // YT_NO_LINK lands here and renders as the mixes explanation.
      showToast(copyForCode(err.code, err.message).title);
    } finally {
      setRefreshing(false);
    }
  };

  const tracks = useMemo(() => hit.data?.tracks ?? [], [hit.data]);
  const shown = useMemo(
    () => sortTracks(filterTracks(tracks, query), sort),
    [tracks, query, sort],
  );

  // One render BEHIND tracks.length by design: when a batch paints, this
  // still holds the pre-batch length — the exact boundary the arrival
  // animation needs. The effect then catches it up for the next batch.
  useEffect(() => {
    prevLenRef.current = tracks.length;
  }, [tracks.length]);

  // The stream just ended with nothing to review: the footer settles ("all N
  // in") and then bows out. Review-carrying jobs skip this — their footer
  // becomes the review entry instead, which should not evaporate.
  const [settledShown, setSettledShown] = useState(false);
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (streaming) {
      wasStreamingRef.current = true;
      return undefined;
    }
    if (!wasStreamingRef.current || !refreshJob) {
      return undefined;
    }
    wasStreamingRef.current = false;
    if ((refreshJob.counts?.review ?? 0) === 0) {
      setSettledShown(true);
      const timer = setTimeout(() => setSettledShown(false), 2200);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [streaming, refreshJob]);
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
      title: 'Make this only you?',
      body: `${bits.join(', ')}. You can share it again anytime.`,
      action: 'Make private',
      // Not destructive — nothing is deleted and it can be shared again
      // anytime; it only wore red because confirm() used to default to it.
      danger: false,
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
      title: `Remove ${c.name}?`,
      body: 'They lose access to this playlist. You can re-invite them anytime.',
      action: 'Remove',
      // Takes someone's access away.
      danger: true,
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
      title: `Remove "${cleanTitle(track.title)}"?`,
      body: 'This only removes it from this playlist. Your likes are untouched.',
      action: 'Remove',
      // Deletes a track out of the playlist.
      danger: true,
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
    // prevLenRef is read through the ref ON PURPOSE (not a dep): rows painted
    // in the same commit as a new batch see the pre-batch boundary, and the
    // closure need not be rebuilt per batch — only `streaming` flipping
    // rebuilds it, which is once per import, not once per wave.
    ({ item: track, index: i }) => (
      <RowArrive
        animate={streaming && i >= prevLenRef.current}
        i={i - prevLenRef.current}
      >
        <PlaylistTrackRow
          track={track}
          index={i}
          highlight={query}
          reason={
            shared && track.addedBy
              ? `Added by ${
                  track.addedBy.userId === myId ? 'you' : track.addedBy.name
                }`
              : undefined
          }
          onPlay={playFrom}
          onRemove={canEdit ? removeTrack : null}
        />
      </RowArrive>
    ),
    [query, shared, myId, playFrom, canEdit, removeTrack, streaming],
  );

  // The streaming tail's footer — under the last row, where the next song
  // will land. One of four voices, never two at once: adding / paused /
  // settled / review. Absent entirely on public views and quiet playlists.
  const reviewCount = refreshJob?.counts?.review ?? 0;
  const footer = publicId
    ? null
    : streaming
    ? (
      <View style={styles.streamFoot}>
        <AuraLoader
          label={YT_COPY.streaming.footer(
            tracks.length,
            jobTotal || tracks.length,
          )}
        />
      </View>
    )
    : jobStalled
    ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={YT_COPY.streaming.paused}
        onPress={jobResume}
        style={({ pressed }) => [styles.streamFoot, pressed && styles.pressed]}
      >
        <Text style={[label(9.5), { color: t.accent }]}>
          {YT_COPY.streaming.paused}
        </Text>
      </Pressable>
    )
    : settledShown
    ? (
      <View style={styles.streamFoot}>
        <Text style={[label(9.5), { color: t.inkSoft }]}>
          {YT_COPY.streaming.settled(tracks.length)}
        </Text>
      </View>
    )
    : importOriginRef.current && !refreshLive && reviewCount > 0 && !reviewing
    ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={YT_COPY.streaming.review(reviewCount)}
        onPress={() => setReviewing(true)}
        style={({ pressed }) => [styles.streamFoot, pressed && styles.pressed]}
      >
        <Text style={[label(9.5), { color: t.accent }]}>
          {YT_COPY.streaming.review(reviewCount)}
        </Text>
      </Pressable>
    )
    : importOriginRef.current &&
      !refreshLive &&
      !!refreshJob?.windowed &&
      reviewCount === 0 &&
      tracks.length > 0
    ? (
      // The owned-mix payoff: a mix import's snapshot ends, and OUR radio
      // keeps the vibe going — seeded by the first imported song, stable and
      // honest where YouTube's tail is per-viewer weather (server/seedMix.js
      // carries the research verdict).
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={YT_COPY.streaming.radio}
        onPress={() => {
          getSeedRadio(tracks[0].id)
            .then(mix => {
              if (!mix?.tracks?.length) {
                return;
              }
              player.playQueue(mix.tracks, 0, mix.name);
              player.ui?.openPlayer?.();
            })
            .catch(() => showToast("Couldn't start the radio."));
        }}
        style={({ pressed }) => [styles.streamFoot, pressed && styles.pressed]}
      >
        <Text style={[label(9.5), { color: t.accent }]}>
          {YT_COPY.streaming.radio}
        </Text>
      </Pressable>
    )
    : null;

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
        // Armed ONLY while streaming: ROW_LAYOUT costs a per-cell pass every
        // frame while enabled (see components/ui/RowArrive), and a settled
        // playlist never reorders under the user.
        itemLayoutAnimation={streaming ? ROW_LAYOUT : undefined}
        ListFooterComponent={footer}
        refreshControl={pull.control}
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

        {status === 'loading' && <AuraLoader label="Loading playlist" />}
        {/* The copy was one fixed sentence for both branches, so opening YOUR
            OWN playlist while offline told you it was private and to ask a
            friend for a share link. The caught message was already in state
            and simply never rendered — every sibling screen shows it.
            Lowercase per docs/CONTEXT.md's stated voice. The public branch
            keeps its retry too: "private or unavailable" is as often a dead
            connection as a real permission wall. */}
        {status === 'error' && (
          <ErrorState
            style={styles.errorBlock}
            message={
              publicId
                ? 'This playlist is private or unavailable. If someone shared it, ask them for a public view link.'
                : hit.error || "Couldn't load this playlist."
            }
            onRetry={retry}
          />
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
                  <Text style={[label(8.5), { color: onScrimInk }]}>
                    Change cover
                  </Text>
                </Pressable>
              )}
            </View>
            <Text style={[label(9.5), { color: t.inkFaint }]}>
              Playlist{shared ? ' · shared' : ''}
            </Text>
            <Text style={[type.queueHero, { color: t.ink }]}>
              {hit.data.name}
            </Text>
            <Text style={[label(9.5), { color: t.inkSoft }]}>
              {isOwner ? 'By you' : `By ${hit.data.ownerName ?? 'someone'}`}
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
                  hitSlop={VIS_SLOP}
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
                  hitSlop={VIS_SLOP}
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
                    {saved ? 'Saved' : 'Save'}
                  </Text>
                </Pressable>
              )}
              {!!ytLink && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={YT_COPY.refresh.action}
                  disabled={refreshing || refreshLive}
                  onPress={checkForNewSongs}
                  hitSlop={VIS_SLOP}
                  style={({ pressed }) => [
                    styles.visChip,
                    { borderColor: t.line },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[label(9.5), { color: t.inkSoft }]}>
                    {refreshing || refreshLive
                      ? YT_COPY.refresh.checking
                      : YT_COPY.refresh.action}
                  </Text>
                </Pressable>
              )}
              {!refreshLive &&
                !reviewing &&
                (refreshJob?.counts?.review ?? 0) > 0 && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={YT_COPY.done.reviewAction}
                    onPress={() => setReviewing(true)}
                    hitSlop={VIS_SLOP}
                    style={({ pressed }) => [
                      styles.visChip,
                      { borderColor: t.accent, backgroundColor: t.accentSoft },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[label(9.5), { color: t.accent }]}>
                      {YT_COPY.done.reviewAction}
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
          <SheetHead text="Who can see this" />
          <SheetRow
            icon="lock"
            label="Only you"
            note="Just for you"
            on={visibility === 'private'}
            disabled={visibility === 'private'}
            onPress={makeOnlyMe}
          />
          <SheetHead
            text={`People you invite${collaborators.length ? ' ·' : ''}`}
          />
          <SheetRow
            icon="people"
            label="Share an edit-invite link"
            note="They can add and remove songs after signing in"
            onPress={shareInvite('editor')}
          />
          <SheetRow
            icon="people"
            label="Share a view-invite link"
            note="They can listen after signing in"
            onPress={shareInvite('viewer')}
          />
          <SheetHead text={`Anyone with the link${isPublic ? ' ·' : ''}`} />
          <SheetRow
            icon="globe"
            label={isPublic ? 'Turn off public link' : 'Make a public view link'}
            on={isPublic}
            disabled={shareBusy}
            onPress={togglePublic}
          />
          {isPublic && !!pubId && (
            <SheetRow
              icon="globe"
              label="Share public link"
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
              Who has access
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
                {isOwner ? 'You' : hit.data?.ownerName ?? 'Someone'}
              </Text>
              <Text style={[label(8.5), { color: t.inkSoft }]}>Owner</Text>
            </View>
          </View>
          {collaborators.map(c => (
            <View key={c.userId} style={styles.member}>
              <Avatar user={c} size={38} />
              <View style={styles.memberMeta}>
                <Text style={[styles.memberName, { color: t.ink }]}>
                  {c.userId === myId ? 'You' : c.name}
                </Text>
                <Text style={[label(8.5), { color: t.inkSoft }]}>
                  Can {c.role === 'viewer' ? 'view' : 'edit'}
                  {c.joinedAt ? ` · joined ${relTime(c.joinedAt)}` : ''}
                </Text>
              </View>
              {isOwner && c.userId !== myId && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`remove ${c.name}`}
                  onPress={() => dropCollaborator(c)}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.removeBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[label(9.5), { color: t.accent }]}>Remove</Text>
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
              Choose a cover
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
              Upload your own image
            </Text>
          </Pressable>
          <Text style={[label(9.5), styles.sheetHead, { color: t.inkFaint }]}>
            Or pick from this playlist
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

      {/* Rendered over this screen rather than pushed, so onDone can hand back
          the re-polled job — navigation cannot return a value from a pop. */}
      {reviewing && refreshJob && (
        <YouTubeReview
          job={refreshJob}
          onDone={updated => {
            if (updated) {
              setRefreshJob(updated);
            }
            setReviewing(false);
            load();
          }}
          onOpenPlaylist={() => setReviewing(false)}
        />
      )}
    </View>
  );
}

// The action chips are bordered pills — only hitSlop can grow them without
// redrawing the border. 11.4dp of label(9.5) + 14 padding = 25.4dp, + 24 =
// 49.4dp tall; sideways they are already past 48 and the slop is held to half
// the row's 10dp gap so wrapped neighbours never overlap.
const VIS_SLOP = { top: 12, bottom: 12, left: 5, right: 5 };

const styles = StyleSheet.create({
  streamFoot: { alignItems: 'center', paddingVertical: 18, gap: 6 },
  root: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 10 },
  // The old content gap, now scoped to the header block so it can't leak
  // 7px seams between the windowed rows; marginBottom keeps the old
  // ListTools→first-row breathing room (styles.list's marginTop).
  head: { gap: 7, marginBottom: 8 },
  stateLine: { ...type.caption, marginTop: 12 },
  errorBlock: { marginTop: 12 },
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
    // Wraps because this row can hold four controls (play all, visibility,
    // save, check-for-new-songs) and they overflow a 360dp screen in one line.
    // visChip already carries marginTop: 10, so a second line looks intended.
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 2,
  },
  visChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginTop: 10,
  },
  empty: { marginTop: 18, gap: 5 },
  emptyTitle: type.blockTitle,
  emptyBody: type.caption,
  pressed: { opacity: 0.6 },
  sheetTitle: { fontFamily: fonts.semibold, fontSize: 18 },
  sheetHead: { marginTop: 12, marginBottom: 2 },
  sheetItemText: type.rowTitle,
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
  },
  memberMeta: { flex: 1, minWidth: 0, gap: 2 },
  // "Remove" is 11.4dp of label(9.5). Padding grows the touch box, the equal
  // negative margin gives the space back, so the member row keeps its height
  // and the word stays put: 11.4 + 24 padding + 16 hitSlop = 51.4dp.
  removeBtn: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginVertical: -12,
    marginHorizontal: -10,
  },
  memberName: type.rowTitle,
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
    borderRadius: radii.card,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginTop: 4,
  },
});
