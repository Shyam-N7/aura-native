import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  LinearTransition,
  runOnJS,
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withSpring,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { usePlaybackProgress } from '../hooks/usePlaybackProgress';
import { addToPlaylist, createPlaylist } from '../api/playlists';
import { storage } from '../storage/mmkv';
import { openTrackActions } from '../lib/trackActionsSheet';
import { openAddToPlaylist } from '../lib/addToPlaylistSheet';
import { showToast } from '../lib/toast';
import { TrackArt } from '../components/TrackRow';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/ui/Sheet';
import { SheetRow } from '../components/ui/SheetRow';
import { cleanTitle } from '../utils/title';
import { fmtTime } from '../utils/fmtTime';
import { LONG_LIST } from '../lib/listWindow';
import { fonts, label, radii } from '../theme/tokens';
import { DUR, EASE, SPRING } from '../theme/motion';

const ROW_HEIGHT = 62;
const SHIFT_MS = 160;
// Auto-scroll while dragging: a continuous per-frame loop (not per-move-event),
// so it keeps scrolling when the finger holds still at the edge and its speed
// ramps with how deep into the edge zone the finger is (quadratic — gentle
// near the zone's inner boundary, fast at the very edge).
const AUTOSCROLL_EDGE = 110; // px from the list's top/bottom that arms scrolling
const AUTOSCROLL_MAX = 26; // px per 60fps frame at the very edge
// An edge zone only fires when the drag is HEADING toward that edge. Position
// alone isn't enough: picking a row up near the list's bottom starts the finger
// already inside the bottom zone, which auto-scrolled toward the end while the
// user was dragging up (field report: "taking me towards 100"). Direction comes
// from a hysteresis detector — the drag must reverse by this many px before its
// direction flips, so finger jitter never flickers the scroll on and off.
const DRAG_DIR_HYST = 12;
// While a drag is in flight the list widens its mount window so the dragged
// cell can't be virtualized away mid-drag. At windowSize 3 a long drag (e.g.
// row 100 → 46) scrolled the origin cell out of the mounted window; it
// unmounted, taking the visible card AND its gesture with it, leaving the
// shifted-open gap the user saw. 11 keeps ~±60 rows mounted (covers realistic
// drags) only for the seconds a drag lasts, then it snaps back to 3.
const DRAG_WINDOW = 11;
// Hide-past pref — the web key/values verbatim ('aura.queueHidePast', '1'/'0');
// read once per open, written on toggle.
const HIDE_PAST_KEY = 'aura.queueHidePast';

// The current row's live line: 'now playing' + a thin bar gliding between
// the 1Hz position ticks. No times here (field feedback: clutter at row
// size) — the row's right edge keeps the total, the player owns the clock.
// Isolated so the ticker re-renders only this leaf, never the list.
function NowPlayingLine({ t }) {
  const { position, duration } = usePlaybackProgress(1000);
  const frac = duration > 0 ? Math.min(1, position / duration) : 0;
  const w = useSharedValue(frac);
  useEffect(() => {
    w.value = withTiming(frac, { duration: 1000, easing: Easing.linear });
  }, [frac, w]);
  const fill = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={styles.npLine}>
      <Text style={[label(8.5), { color: t.accent }]}>now playing</Text>
      <View style={[styles.npBar, { backgroundColor: t.line }]}>
        <Animated.View
          style={[styles.npFill, { backgroundColor: t.accent }, fill]}
        />
      </View>
    </View>
  );
}

// One queue row. Drag-reorder ports the web DesktopQueue math onto fixed-height
// rows: the dragged row rides the finger (translation + scroll delta), rows
// between origin and target shift one slot, drop commits reorder(from, to).
// All motion is UI-thread; only pickup/commit cross to JS.
//
// Arbitration: the grip pan BLOCKS the list's native scroll gesture — a touch
// on the grip makes the scroll wait, so pickup can't lose the race (the
// earlier long-press arming, and even plain activation offsets, sometimes
// did). No scrollEnabled toggling either: that state flip re-rendered the
// whole list at the exact moment of pickup, which read as jank.
function Row({
  item,
  index,
  isCurrent,
  isPast,
  player,
  dragFrom,
  dragTo,
  dragShift,
  scrollY,
  scrollStart,
  scrollCmd,
  dragDir,
  dirPivot,
  base,
  count,
  listGesture,
  onDrag,
  fingerY,
  fingerTransY,
  listTop,
}) {
  const { t } = useTheme();
  const title = cleanTitle(item.title);

  const pickup = useCallback(() => {
    Vibration.vibrate(10);
  }, []);

  const commit = (from, to) => {
    if (from !== to) {
      Vibration.vibrate(8);
    }
    player.reorder(from, to);
    // Release the drag one frame later so the list paints the new order
    // before rows stop compensating — avoids a one-frame jump-back.
    requestAnimationFrame(() => {
      dragFrom.value = -1;
      dragShift.value = 0;
    });
  };

  // A second finger on another grip must not fight over the shared drag
  // slots — first pickup wins, the other pan runs inert.
  const owns = useSharedValue(false);

  const pan = Gesture.Pan()
    .activeOffsetY([-4, 4])
    .failOffsetX([-16, 16])
    .blocksExternalGesture(listGesture)
    .onStart(e => {
      'worklet';
      owns.value = dragFrom.value === -1;
      if (!owns.value) {
        return;
      }
      dragFrom.value = index;
      dragTo.value = index;
      dragShift.value = 0;
      scrollStart.value = scrollY.value;
      // The auto-scroll drives the list from scrollCmd, an offset it OWNS and
      // accumulates. scrollY (event-fed) can't be the loop's feedback: on
      // Android a programmatic scrollTo doesn't reliably echo a scroll event,
      // so reading it back froze the offset near its start — each frame
      // re-commanded almost the same spot and the "auto-scroll" only crept
      // (field report: "very very laggy"). Seed it with the real offset here;
      // during a drag the native scroll gesture is blocked, so no one else
      // moves the list underneath it.
      scrollCmd.value = scrollY.value;
      dragDir.value = 0;
      dirPivot.value = 0;
      fingerY.value = e.absoluteY;
      fingerTransY.value = 0;
      // Anchor the edge zones to the list's real on-screen top. Derive it from
      // the finger itself: at pickup the finger is on THIS row, whose content-Y
      // is known (rendered index × ROW_HEIGHT), so
      //   listTop = fingerY − (rowContentY − scrollY) − ~half a row
      // (the grip is grabbed mid-row). This lives in the SAME absolute space as
      // fingerY, so the frame loop's zone test is consistent. `measure()` on an
      // Animated.FlatList came back null / content-relative (negative once
      // scrolled), which parked the finger permanently in the bottom zone and
      // scrolled the wrong way — the "reverse" report.
      listTop.value =
        e.absoluteY -
        ((index - base) * ROW_HEIGHT - scrollY.value) -
        ROW_HEIGHT / 2;
      runOnJS(pickup)();
      // Widen the mount window for the duration of the drag (see DRAG_WINDOW)
      // so this cell survives being scrolled far from the viewport.
      runOnJS(onDrag)(true);
    })
    .onUpdate(e => {
      'worklet';
      if (!owns.value) {
        return;
      }
      // Capture the finger; the continuous frame loop owns the scroll and
      // re-derives the drag-follow math so it stays smooth when the finger
      // holds still at the edge (see the useFrameCallback in QueueSheet).
      fingerY.value = e.absoluteY;
      fingerTransY.value = e.translationY;
      // Which way is the drag heading? dirPivot rides the translation's
      // running extreme; the direction only flips once the finger has come
      // back past it by DRAG_DIR_HYST. The frame loop uses this to arm only
      // the edge zone the drag is moving TOWARD.
      const ty = e.translationY;
      if (ty - dirPivot.value > DRAG_DIR_HYST) {
        dragDir.value = 1;
        dirPivot.value = ty;
      } else if (ty - dirPivot.value < -DRAG_DIR_HYST) {
        dragDir.value = -1;
        dirPivot.value = ty;
      } else if (
        (dragDir.value === 1 && ty > dirPivot.value) ||
        (dragDir.value === -1 && ty < dirPivot.value)
      ) {
        dirPivot.value = ty;
      }
      dragShift.value = ty + scrollCmd.value - scrollStart.value;
      const to = index + Math.round(dragShift.value / ROW_HEIGHT);
      // `base` floors drops at the first RENDERED row — with hide-past on,
      // the hidden history above the current track is not a drop target.
      dragTo.value = Math.max(base, Math.min(count - 1, to));
    })
    .onEnd(() => {
      'worklet';
      if (!owns.value) {
        return;
      }
      runOnJS(commit)(dragFrom.value, dragTo.value);
    })
    .onFinalize((_e, success) => {
      'worklet';
      if (!owns.value) {
        return;
      }
      if (!success) {
        dragFrom.value = -1;
        dragShift.value = 0;
      }
      owns.value = false;
      // Drag over (committed or cancelled) — let the list shed the window.
      runOnJS(onDrag)(false);
    });

  const rowStyle = useAnimatedStyle(() => {
    if (dragFrom.value === index) {
      return {
        zIndex: 5,
        transform: [{ translateY: dragShift.value }, { scale: 1.01 }],
      };
    }
    let shift = 0;
    if (dragFrom.value >= 0) {
      if (dragFrom.value < index && index <= dragTo.value) {
        shift = -ROW_HEIGHT;
      } else if (dragTo.value <= index && index < dragFrom.value) {
        shift = ROW_HEIGHT;
      }
    }
    return {
      zIndex: 0,
      transform: [
        { translateY: withTiming(shift, { duration: SHIFT_MS }) },
        { scale: 1 },
      ],
    };
  });

  const liftStyle = useAnimatedStyle(() => ({
    // Opaque surface while lifted so the row reads over its neighbours
    // (never elevation — translucent + elevation = white slab).
    backgroundColor:
      dragFrom.value === index
        ? t.surface
        : isCurrent
        ? t.accentSoft
        : 'transparent',
  }));

  return (
    <Animated.View style={[styles.row, isPast && styles.past, rowStyle]}>
      <Animated.View style={[styles.rowFill, liftStyle]} />
      <GestureDetector gesture={pan}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`reorder ${title}`}
          hitSlop={8}
          style={styles.grip}
        >
          <Icon name="grip" size={18} color={t.inkFaint} />
        </Pressable>
      </GestureDetector>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`play ${title}`}
        onPress={() => player.jumpTo(index)}
        onLongPress={() =>
          openTrackActions({
            track: item,
            // Queue rows: play/queue actions are redundant here (web parity).
            menu: { omit: ['play', 'playNext', 'addToQueue'] },
          })
        }
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
      >
        <Text style={[styles.idx, { color: t.inkFaint }]}>
          {String(index + 1).padStart(2, '0')}
        </Text>
        <TrackArt track={item} size={44} radius={7} />
        <View style={styles.meta}>
          <Text
            numberOfLines={1}
            style={[styles.title, { color: isCurrent ? t.accent : t.ink }]}
          >
            {title}
          </Text>
          {isCurrent ? (
            <NowPlayingLine t={t} />
          ) : (
            <Text
              numberOfLines={1}
              style={[styles.artist, { color: t.inkSoft }]}
            >
              {item.artist ?? ''}
            </Text>
          )}
        </View>
        {!!item.durationSec && (
          <Text style={[styles.time, { color: t.inkFaint }]}>
            {fmtTime(item.durationSec)}
          </Text>
        )}
      </Pressable>
      {!isCurrent && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`remove ${title}`}
          onPress={() => player.removeAt(index)}
          hitSlop={8}
          style={styles.remove}
        >
          <Icon name="close" size={15} color={t.inkFaint} />
        </Pressable>
      )}
    </Animated.View>
  );
}

// The queue overflow menu — web DesktopQueue's ⋯ actions (save / add / clear)
// plus its hide-past header toggle, folded into one bottom sheet. Only the
// queue header opens it, so it keeps local open state instead of a bus; the
// Sheet chassis (zIndex 50) stacks it over the queue (40). "save queue as
// playlist" swaps the menu for an inline name step (the AddToPlaylistSheet
// new-playlist pattern — native has no prompt dialog).
function QueueOptionsSheet({ player, hidePast, onToggleHidePast, onClose }) {
  const { t } = useTheme();
  const [naming, setNaming] = useState(false);
  // Empty like the web's prompt (and AddToPlaylistSheet): the user must name
  // it consciously — a bare double-save must not mint twin "my queue"s.
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const tracks = player.queue?.tracks ?? [];
  const idx = player.queue?.idx ?? 0;

  // Menu items close the sheet first, TrackActionsSheet-style.
  const act = fn => () => {
    onClose();
    fn();
  };

  // Native's confirm precedent is Alert.alert (sign out, playlist delete /
  // leave). Clearing keeps the playing track, so the body says so (web copy).
  const confirmClear = () =>
    Alert.alert('clear queue?', "we'll keep the currently playing track.", [
      { text: 'cancel', style: 'cancel' },
      {
        text: 'clear',
        style: 'destructive',
        onPress: () => player.clearQueue(),
      },
    ]);

  const saveQueue = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) {
      return;
    }
    setBusy(true);
    try {
      const playlist = await createPlaylist({ name: trimmed });
      // Partial-failure tolerant like web's allSettled — one bad track never
      // aborts the rest; the summary toast owns the arithmetic.
      let added = 0;
      for (const track of tracks) {
        try {
          await addToPlaylist(playlist.id, track.id);
          added += 1;
        } catch {
          // skipped — reported by the summary toast
        }
      }
      showToast(
        added === tracks.length
          ? 'saved.'
          : `saved ${added} of ${tracks.length}.`,
        { tick: true },
      );
      onClose();
    } catch (err) {
      console.warn('[save-queue]', err?.message ?? err);
      showToast("couldn't save.");
      setBusy(false);
    }
  };

  // animated={false}: this sheet lives under QueueSheet's null gate, which an
  // external queueOpen flip can hard-unmount mid-animation — the reanimated
  // 4.2.3/Fabric native-abort class. It pops instead of sliding.
  if (naming) {
    return (
      <Sheet animated={false} onClose={onClose} closeLabel="close queue options">
        <Text style={[styles.menuTitle, { color: t.ink }]}>
          save queue as playlist
        </Text>
        <Text style={[label(9.5), styles.menuSub, { color: t.inkFaint }]}>
          {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
        </Text>
        {busy ? (
          <Text style={[styles.menuState, { color: t.inkFaint }]}>
            saving to {name.trim()}
          </Text>
        ) : (
          <>
            <TextInput
              autoFocus
              accessibilityLabel="playlist name"
              value={name}
              onChangeText={setName}
              onSubmitEditing={saveQueue}
              placeholder="playlist name"
              placeholderTextColor={t.inkFaint}
              cursorColor={t.accent}
              selectionColor={t.accent}
              style={[
                styles.nameInput,
                { color: t.ink, borderColor: t.line, backgroundColor: t.bg },
              ]}
            />
            <View style={styles.nameActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="cancel"
                onPress={() => {
                  setNaming(false);
                  setName('');
                }}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <Text style={[styles.nameBtn, { color: t.inkSoft }]}>
                  cancel
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="save"
                disabled={!name.trim()}
                onPress={saveQueue}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <Text
                  style={[
                    styles.nameBtn,
                    { color: name.trim() ? t.accent : t.inkFaint },
                  ]}
                >
                  save
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </Sheet>
    );
  }

  // TrackActionsSheet's anatomy exactly: context head (art + what this menu
  // is about), then icon rows — one sheet language everywhere.
  return (
    <Sheet animated={false} onClose={onClose} closeLabel="close queue options">
      <View style={styles.menuHead}>
        <TrackArt track={tracks[idx]} size={44} radius={6} />
        <View style={styles.menuHeadMeta}>
          <Text
            numberOfLines={1}
            style={[styles.menuHeadTitle, { color: t.ink }]}
          >
            queue options
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.menuHeadSub, { color: t.inkSoft }]}
          >
            {player.queue?.source ?? 'your set'} · {tracks.length}{' '}
            {tracks.length === 1 ? 'track' : 'tracks'}
          </Text>
        </View>
      </View>
      {tracks.length > 0 && (
        <SheetRow
          icon="plus"
          label="save queue as playlist"
          onPress={() => setNaming(true)}
        />
      )}
      {tracks.length > 0 && (
        <SheetRow
          icon="queue-add"
          label="add queue to playlist"
          onPress={act(() => openAddToPlaylist(tracks))}
        />
      )}
      {/* Web gates this behind currentIdx > 0 — with no past songs the toggle
          is a silent no-op. `hidePast` keeps it reachable to switch back off. */}
      {(idx > 0 || hidePast) && (
        <SheetRow
          icon={hidePast ? 'eye' : 'eye-off'}
          label={hidePast ? 'show past songs' : 'hide past songs'}
          onPress={act(onToggleHidePast)}
        />
      )}
      {tracks.length > 1 && (
        <>
          <View style={[styles.menuSeparator, { backgroundColor: t.line }]} />
          <SheetRow
            icon="close"
            danger
            label="clear queue"
            onPress={act(confirmClear)}
          />
        </>
      )}
    </Sheet>
  );
}

// The live queue as its own overlay ABOVE the player sheet: opening it never
// closes the player, and closing it lands back exactly where you were (field
// feedback — the old navigator screen forced the player shut first). Slides
// up like the player, drags down from its header to dismiss, hardware back
// closes it first (registered later than the player's handler, LIFO).
export function QueueSheet() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const player = usePlayer();
  const reduced = useReducedMotion();
  const open = player.ui?.queueOpen ?? false;
  const { tracks, idx, source } = player.queue ?? {
    tracks: [],
    idx: -1,
    source: null,
  };

  // 'closed' | 'open' | 'closing' — the PlayerSheet mount grammar.
  const [vis, setVis] = useState('closed');
  const slide = useSharedValue(winH);
  const dragY = useSharedValue(0);

  // Shuffle animation: a short window during which the list's layout animation
  // is armed, so shuffling flies the visible tiles to their new positions (and
  // un-shuffle flies them back). Set synchronously with the toggle so the very
  // render that reorders the data is the one that animates. Off otherwise, so
  // it never touches the hand-tuned drag-reorder.
  const [shuffleAnim, setShuffleAnim] = useState(false);
  const shuffleTimer = useRef(null);
  const doShuffle = useCallback(() => {
    if (!reduced) {
      setShuffleAnim(true);
      clearTimeout(shuffleTimer.current);
      shuffleTimer.current = setTimeout(() => setShuffleAnim(false), 480);
    }
    player.toggleShuffle();
  }, [reduced, player]);
  useEffect(() => () => clearTimeout(shuffleTimer.current), []);

  // Overflow menu + the hide-past pref it toggles.
  const [menuOpen, setMenuOpen] = useState(false);
  const [hidePast, setHidePast] = useState(
    () => storage.getItem(HIDE_PAST_KEY) === '1',
  );
  const toggleHidePast = () => {
    const nextHidden = !hidePast;
    storage.setItem(HIDE_PAST_KEY, nextHidden ? '1' : '0');
    setHidePast(nextHidden);
  };

  // Per-track keys (id + occurrence), stable across a reorder — so on shuffle a
  // tile KEEPS its React instance and the layout animation flies it to its new
  // position instead of remounting it in place. (Index-based keys would make
  // every moved tile a "new" one, killing the animation.) Kept above the
  // sheet's early return so the hook order never changes.
  const rowKeys = useMemo(() => {
    const ph = hidePast ? Math.max(0, idx) : 0;
    const rows = ph ? tracks.slice(ph) : tracks;
    const seen = Object.create(null);
    return rows.map(item => {
      const n = (seen[item.id] = (seen[item.id] ?? 0) + 1);
      return `${item.id}#${n}`;
    });
  }, [tracks, idx, hidePast]);

  const endClose = useCallback(() => setVis('closed'), []);

  useEffect(() => {
    if (open && vis === 'closed') {
      dragY.value = 0;
      if (reduced) {
        slide.value = 0;
      } else {
        slide.value = winH;
        slide.value = withSpring(0, SPRING.sheet);
      }
      setVis('open');
    }
    // Closed from outside the sheet (sign-out) — resync the mount machine so
    // the next open still gets its slide-in.
    if (!open && vis === 'open') {
      setVis('closed');
      setMenuOpen(false);
    }
  }, [open, vis, reduced, winH, slide, dragY]);

  const close = useCallback(() => {
    if (vis === 'closing') {
      return;
    }
    setVis('closing');
    setMenuOpen(false);
    // Belt-and-suspenders: never leave the wide drag window pinned if the
    // sheet closes mid-drag (onFinalize normally clears this on gesture end).
    setDragging(false);
    player.ui?.closeQueue?.();
    if (reduced) {
      endClose();
      return;
    }
    slide.value = withTiming(
      winH,
      { duration: DUR.sheetOut, easing: EASE.exit },
      done => {
        if (done) {
          runOnJS(endClose)();
        }
      },
    );
  }, [vis, reduced, endClose, player.ui, winH, slide]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [open, close]);

  const dragFrom = useSharedValue(-1);
  const dragTo = useSharedValue(-1);
  const dragShift = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const scrollStart = useSharedValue(0);
  const listH = useSharedValue(0);
  const listRef = useAnimatedRef();

  // True only while a row is actively being dragged — widens the FlatList
  // mount window so the dragged cell isn't virtualized away (see DRAG_WINDOW).
  // Set from the grip pan's start/finalize (UI thread → JS via runOnJS).
  const [dragging, setDragging] = useState(false);
  const onDrag = useCallback(v => setDragging(v), []);

  // Auto-scroll frame loop inputs: the finger's screen Y + translation (written
  // by the grip pan) and the list's derived on-screen top.
  const fingerY = useSharedValue(0);
  const fingerTransY = useSharedValue(0);
  const listTop = useSharedValue(0);
  // The offset the auto-scroll commands — owned by the loop, never read back
  // from scroll events (see the seeding comment in Row's pan.onStart).
  const scrollCmd = useSharedValue(0);
  // Drag heading (-1 up · 0 none yet · 1 down) + its hysteresis pivot — written
  // by the grip pan, read by the frame loop to arm only the matching edge zone.
  const dragDir = useSharedValue(0);
  const dirPivot = useSharedValue(0);
  // The drop-clamp bounds, mirrored into shared values so the frame worklet can
  // read them (base = first droppable row with hide-past on; count = queue len).
  const baseSV = useSharedValue(0);
  const countSV = useSharedValue(0);
  useEffect(() => {
    baseSV.value = hidePast ? Math.max(0, idx) : 0;
    countSV.value = tracks.length;
  }, [hidePast, idx, tracks.length, baseSV, countSV]);

  // Continuous auto-scroll: runs every frame while a drag is active (not tied
  // to finger-move events, so it keeps going when the finger holds at the edge)
  // and ramps speed quadratically with edge depth. It also re-derives the
  // drag-follow offset + drop target each frame so a still finger still advances
  // the slot as the list scrolls beneath it.
  const autoScroll = useFrameCallback(frame => {
    'worklet';
    if (dragFrom.value < 0) {
      return;
    }
    const dt = (frame.timeSincePreviousFrame ?? 16) / 16.667;
    const top = listTop.value;
    const bottom = top + listH.value;
    const y = fingerY.value;
    // A zone fires only when the drag is heading toward it (dragDir) AND the
    // finger is inside it — speed ramps quadratically with edge depth.
    let vel = 0;
    if (dragDir.value === -1 && y < top + AUTOSCROLL_EDGE) {
      const d = Math.min(1, (top + AUTOSCROLL_EDGE - y) / AUTOSCROLL_EDGE);
      vel = -AUTOSCROLL_MAX * d * d;
    } else if (dragDir.value === 1 && y > bottom - AUTOSCROLL_EDGE) {
      const d = Math.min(1, (y - (bottom - AUTOSCROLL_EDGE)) / AUTOSCROLL_EDGE);
      vel = AUTOSCROLL_MAX * d * d;
    }
    if (vel !== 0) {
      // Integrate on scrollCmd (the loop's own offset), clamped to the rows'
      // real extent so the last row stops flush at the viewport bottom.
      const maxY = Math.max(
        0,
        (countSV.value - baseSV.value) * ROW_HEIGHT - listH.value,
      );
      const next = Math.max(0, Math.min(maxY, scrollCmd.value + vel * dt));
      if (next !== scrollCmd.value) {
        scrollCmd.value = next;
        scrollTo(listRef, 0, next, false);
        // Mirror into the event-fed value: programmatic scrolls don't always
        // echo an event, and everything downstream reads scrollY.
        scrollY.value = next;
      }
    }
    dragShift.value = fingerTransY.value + scrollCmd.value - scrollStart.value;
    const to = dragFrom.value + Math.round(dragShift.value / ROW_HEIGHT);
    dragTo.value = Math.max(baseSV.value, Math.min(countSV.value - 1, to));
  }, false);
  useEffect(() => {
    autoScroll.setActive(dragging);
  }, [dragging, autoScroll]);

  // The list's own scroll as an explicit gesture, so row grips can make it
  // wait (see Row).
  const listGesture = useMemo(() => Gesture.Native(), []);

  const onScroll = useAnimatedScrollHandler(e => {
    scrollY.value = e.contentOffset.y;
  });

  // Drag-follow dismiss from the header; the close() slide-out starts from
  // wherever the drag left the sheet (the transforms sum), no jump.
  const dismissPan = Gesture.Pan()
    .activeOffsetY(16)
    .failOffsetY(-16)
    .onUpdate(e => {
      'worklet';
      dragY.value = Math.max(0, e.translationY);
    })
    .onEnd(e => {
      'worklet';
      if (e.velocityY > 900 || dragY.value > winH * 0.22) {
        runOnJS(close)();
      } else {
        dragY.value = withSpring(0, SPRING.snapback);
      }
    });

  const sheetStyle = useAnimatedStyle(() => {
    const p = Math.min(1, dragY.value / (winH * 0.5));
    return {
      transform: [
        { translateY: slide.value + dragY.value },
        { scale: 1 - p * 0.04 },
      ],
      borderRadius: p * radii.sheet,
    };
  });

  if (!open && vis !== 'closing') {
    return null;
  }

  // Hide-past renders only the current track onward (web keeps collapsed rows
  // in the DOM; a FlatList just gets the tail slice). Rows keep their ABSOLUTE
  // queue index — jumpTo/removeAt/reorder and the drag math all address the
  // real queue, so the slice only re-bases what's mounted and the model and
  // the native player never see a different numbering.
  const pastHidden = hidePast ? Math.max(0, idx) : 0;
  const visible = pastHidden ? tracks.slice(pastHidden) : tracks;

  const renderItem = ({ item, index }) => {
    const at = index + pastHidden;
    return (
      <Row
        item={item}
        index={at}
        isCurrent={at === idx}
        isPast={at < idx}
        player={player}
        dragFrom={dragFrom}
        dragTo={dragTo}
        dragShift={dragShift}
        scrollY={scrollY}
        scrollStart={scrollStart}
        scrollCmd={scrollCmd}
        dragDir={dragDir}
        dirPivot={dirPivot}
        base={pastHidden}
        count={tracks.length}
        listGesture={listGesture}
        onDrag={onDrag}
        fingerY={fingerY}
        fingerTransY={fingerTransY}
        listTop={listTop}
      />
    );
  };

  // AURA's prefetched continuation, listed under the last track as what's
  // coming. The context hands this over already deduped against the live queue
  // and only while it's actually reachable, so row i is queue position idx+1+i
  // and tapping one fills the whole batch in and plays from there.
  const radioBatch = player.autoNextTracks;
  const renderRadio = () => {
    if (!radioBatch?.length) {
      return null;
    }
    return (
      <View style={[styles.radio, { borderTopColor: t.line }]}>
        <Text style={[label(9), { color: t.inkFaint }, styles.radioLabel]}>
          up next · picked by aura
        </Text>
        {radioBatch.map((rt, i) => (
          <Pressable
            key={`${rt.id}-${i}`}
            accessibilityRole="button"
            accessibilityLabel={`play next: ${cleanTitle(rt.title)}`}
            onPress={() => player.playAutoNext(i)}
            onLongPress={() => openTrackActions({ track: rt })}
            style={({ pressed }) => [
              styles.radioRow,
              pressed && styles.pressed,
            ]}
          >
            <TrackArt track={rt} size={40} radius={4} />
            <View style={styles.meta}>
              <Text numberOfLines={1} style={[styles.title, { color: t.ink }]}>
                {cleanTitle(rt.title)}
              </Text>
              <Text
                numberOfLines={1}
                style={[styles.artist, { color: t.inkSoft }]}
              >
                {rt.artist ?? ''}
              </Text>
            </View>
            <Text style={[label(9), { color: t.accent }]}>play</Text>
          </Pressable>
        ))}
      </View>
    );
  };

  return (
    <>
      <Animated.View
        style={[
          styles.root,
          { backgroundColor: t.bg, paddingTop: insets.top },
          sheetStyle,
        ]}
      >
        <GestureDetector gesture={dismissPan}>
          <View>
            <View style={[styles.sheetGrip, { backgroundColor: t.line }]} />
            <View style={styles.header}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="close queue"
                onPress={close}
                hitSlop={10}
                style={styles.back}
              >
                <Icon name="chevron-down" size={24} color={t.ink} />
              </Pressable>
              <View style={styles.headMeta}>
                <Text style={[styles.source, { color: t.ink }]}>
                  {source ?? 'up next'}
                </Text>
                <Text style={[styles.count, { color: t.inkFaint }]}>
                  {visible.length} {visible.length === 1 ? 'track' : 'tracks'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  player.shuffleActive ? 'shuffle off' : 'shuffle'
                }
                onPress={doShuffle}
                hitSlop={8}
                style={styles.toggle}
              >
                <Icon
                  name="shuffle"
                  size={20}
                  color={player.shuffleActive ? t.accent : t.inkFaint}
                />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`repeat ${player.repeat}`}
                onPress={player.cycleRepeat}
                hitSlop={8}
                style={styles.toggle}
              >
                <Icon
                  name={player.repeat === 'one' ? 'repeat-one' : 'repeat'}
                  size={20}
                  color={player.repeat !== 'off' ? t.accent : t.inkFaint}
                />
              </Pressable>
              {/* No button on an empty queue — every menu item needs tracks
                  (or past songs) to act on, so the menu would open bare. */}
              {tracks.length > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="queue options"
                  onPress={() => setMenuOpen(true)}
                  hitSlop={8}
                  style={styles.toggle}
                >
                  <Icon name="dots" size={20} color={t.inkFaint} />
                </Pressable>
              )}
            </View>
          </View>
        </GestureDetector>

        {tracks.length === 0 ? (
          <Text style={[styles.empty, { color: t.inkFaint }]}>
            nothing queued yet — play something first.
          </Text>
        ) : (
          <GestureDetector gesture={listGesture}>
            <Animated.FlatList
              ref={listRef}
              data={visible}
              renderItem={renderItem}
              keyExtractor={(_item, index) => rowKeys[index]}
              // Mounted at REST so reanimated is already tracking each cell's
              // position when a shuffle lands (arming it only on the reorder
              // render is too late — the "before" layout was never captured);
              // the duration is 0 except during the shuffle window (~420ms), so
              // the tiles fly to their new slots then and snap instantly other-
              // wise.
              // But it is fully DETACHED during an active drag: the manual
              // drag-reorder owns every pixel of its motion through explicit
              // transforms, and a live layout animation — even at duration 0 the
              // machinery still runs a per-cell layout pass every frame — fights
              // the auto-scroll near the edges and jitters the rows (the "shake"
              // when dragging a song to the bottom). undefined ⇒ plain cells
              // while dragging; it re-attaches on drop, in time for the shuffle.
              itemLayoutAnimation={
                dragging
                  ? undefined
                  : LinearTransition.duration(shuffleAnim && !reduced ? 420 : 0)
              }
              getItemLayout={(_, index) => ({
                length: ROW_HEIGHT,
                offset: ROW_HEIGHT * index,
                index,
              })}
              // Jump to the current row ONLY when the list actually overflows
              // the window. On a list that fits, the native scroll clamps the
              // jump to zero while the virtualizer still believes the offset —
              // and with nothing to scroll, no event ever corrects it, so the
              // rows BEFORE the current one never render (field report: a
              // 10-track queue showed a void where the past songs belonged).
              initialScrollIndex={
                visible.length * ROW_HEIGHT > winH
                  ? Math.max(0, Math.min(idx - pastHidden, visible.length - 1))
                  : undefined
              }
              // An element, not a component type — a fresh type each render would
              // remount the batch (and its artwork) on every scroll tick.
              ListFooterComponent={renderRadio()}
              onScroll={onScroll}
              scrollEventThrottle={16}
              overScrollMode="always"
              onLayout={e => {
                listH.value = e.nativeEvent.layout.height;
              }}
              // Shifted neighbours must draw outside their cell while dragging.
              removeClippedSubviews={false}
              // A queue can be a whole shared playlist (245 tracks in the
              // field) — unbounded mounting OOM-killed the app on open.
              {...LONG_LIST}
              // Override only while dragging so the dragged cell stays mounted
              // (long-drag fix); back to LONG_LIST's 3 at rest.
              windowSize={dragging ? DRAG_WINDOW : LONG_LIST.windowSize}
              contentContainerStyle={[
                styles.list,
                { paddingBottom: insets.bottom + 24 },
              ]}
            />
          </GestureDetector>
        )}
      </Animated.View>
      {menuOpen && (
        <QueueOptionsSheet
          player={player}
          hidePast={hidePast}
          onToggleHidePast={toggleHidePast}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    // zIndex only — see PlayerSheet.root for the overlay ladder.
    zIndex: 40,
    overflow: 'hidden',
  },
  sheetGrip: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginTop: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
  },
  back: {
    width: 32,
    alignItems: 'center',
  },
  headMeta: {
    flex: 1,
    gap: 1,
  },
  source: {
    fontSize: 17,
    fontWeight: '600',
  },
  count: {
    fontSize: 12,
  },
  toggle: {
    paddingHorizontal: 6,
  },
  list: {
    paddingHorizontal: 10,
    paddingTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ROW_HEIGHT,
    borderRadius: 10,
    paddingLeft: 2,
    paddingRight: 4,
  },
  rowFill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 10,
  },
  past: {
    opacity: 0.55,
  },
  radio: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  radioLabel: {
    paddingHorizontal: 6,
    marginBottom: 4,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 56,
    borderRadius: 10,
    paddingHorizontal: 6,
  },
  grip: {
    width: 30,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pressed: {
    opacity: 0.6,
  },
  idx: {
    width: 22,
    fontSize: 11,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  meta: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 14.5,
    fontWeight: '500',
  },
  artist: {
    fontSize: 12,
  },
  npLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  npBar: {
    flex: 1,
    height: 3,
    // Radius past half-height clamps to a true pill, so the caps render
    // round even at this size (1.5 came out visibly squared-off on device).
    borderRadius: 999,
    overflow: 'hidden',
  },
  npFill: {
    height: 3,
    borderRadius: 999,
  },
  time: {
    fontSize: 11.5,
    fontVariant: ['tabular-nums'],
  },
  remove: {
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  empty: {
    fontSize: 13.5,
    paddingHorizontal: 20,
    marginTop: 16,
  },
  // Overflow menu (QueueOptionsSheet) — SleepTimerSheet's row register plus
  // AddToPlaylistSheet's inline name-input recipe.
  menuTitle: { fontFamily: fonts.semibold, fontSize: 18 },
  menuSub: { marginTop: 3, marginBottom: 8 },
  menuHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 10,
  },
  menuHeadMeta: { flex: 1, minWidth: 0, gap: 2 },
  menuHeadTitle: { fontFamily: fonts.medium, fontSize: 15 },
  menuHeadSub: { fontFamily: fonts.regular, fontSize: 12.5 },
  menuSeparator: { height: 1, marginVertical: 6 },
  menuState: {
    fontFamily: fonts.regular,
    fontSize: 13.5,
    paddingVertical: 12,
  },
  nameInput: {
    borderWidth: 1,
    borderRadius: radii.input,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: fonts.regular,
    fontSize: 15,
    marginTop: 2,
  },
  nameActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 22,
    paddingVertical: 10,
  },
  nameBtn: { fontFamily: fonts.medium, fontSize: 14.5 },
});
