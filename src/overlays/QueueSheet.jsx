import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
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
  interpolate,
  runOnJS,
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withSequence,
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
import * as autoRadio from '../playback/autoRadio';
import { openAddToPlaylist } from '../lib/addToPlaylistSheet';
import { showToast } from '../lib/toast';
import { confirm } from '../lib/confirm';
import { TrackArt } from '../components/TrackRow';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/ui/Sheet';
import { SheetRow } from '../components/ui/SheetRow';
import { cleanTitle } from '../utils/title';
import { fmtTime } from '../utils/fmtTime';
import { LONG_LIST } from '../lib/listWindow';
import { fonts, label, radii } from '../theme/tokens';
import { DUR, EASE, SPRING } from '../theme/motion';
import { countRender } from '../lib/renderCount';

const ROW_HEIGHT = 62;
// Fixed-height rows, so the virtualizer never has to measure one. Hoisted
// rather than inline: it closes over nothing, and a fresh function per render
// is one more prop the list has to diff.
const ROW_LAYOUT = (_data, index) => ({
  length: ROW_HEIGHT,
  offset: ROW_HEIGHT * index,
  index,
});

// The list's own top padding — shared with styles.list so the drop indicator
// sits on the same origin the rows do.
const LIST_TOP_PAD = 4;

// Sentinel list item: the "up next · picked by aura" header row that sits
// between the real queue and the suggestion rows. Rendered at ROW_HEIGHT so
// the fixed-height drag math stays uniform around it.
const RADIO_HEAD = { id: '__aura-up-next', __radioHead: true };
// Dropping a song above the playing track is allowed — it just isn't what
// "next" means any more, and that is invisible unless we say it.
const BEHIND_MSG = "That sits behind what's playing — it won't play next.";
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

// Rows fade in the moment the sheet lands — they mount only then (see the
// `landed` gate): committing ~14 art rows mid-spring dropped frames halfway
// up the screen (field report: "it strucks at middle for a millisecond").
// Shared values, never an entering animation (the 4.2.3/Fabric crash class).
function ListFade({ reduced, children }) {
  const o = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    o.value = withTiming(1, { duration: DUR.dot, easing: EASE.settle });
  }, [o]);
  const s = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[styles.listFade, s]}>{children}</Animated.View>;
}

// The current row's live line: 'now playing' + a thin bar gliding between
// the 1Hz position ticks. No times here (field feedback: clutter at row
// size) — the row's right edge keeps the total, the player owns the clock.
// Isolated so the ticker re-renders only this leaf, never the list.
// Where the tile will land. A live line at the top edge of the target slot,
// driven by the SAME shared values the drop itself commits from — so what it
// promises and what happens can never disagree. Purely presentational, and
// hidden both at rest and when the target is the row's own slot (nothing
// would change, so nothing is claimed).
function DropLine({ accent, dragFrom, dragTo, baseSV, scrollY }) {
  const style = useAnimatedStyle(() => {
    // Shown for the whole drag, including while the target still equals the
    // row's own index. Hiding that case looked tidy and was the bug: a pick's
    // own index IS the first up-next position, so crossing into the queue
    // takes a full row of travel during which the target never changes — the
    // line vanished for exactly the stretch where the user is trying to judge
    // the crossing. Inside up next the target changes every row, which is why
    // it only ever looked broken on the way into the queue.
    if (dragFrom.value < 0) {
      return { opacity: 0 };
    }
    return {
      opacity: 1,
      transform: [
        {
          // scrollY, NOT scrollCmd. Both track the list during a drag, but
          // scrollCmd is only written when the auto-scroll has velocity and is
          // clamped against maxY — an ESTIMATE of the content extent built from
          // (count - base) rows. When that estimate is off, scrollCmd drifts
          // from where the list actually sits and the line inherits the error,
          // parking somewhere the tile never goes. scrollY is fed by the real
          // scroll events as well, so it self-corrects.
          translateY:
            LIST_TOP_PAD +
            (dragTo.value - baseSV.value) * ROW_HEIGHT -
            scrollY.value,
        },
      ],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.dropLine, { backgroundColor: accent }, style]}
    />
  );
}

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
      <Text style={[label(8.5), { color: t.accent }]}>Now playing</Text>
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
//
// Memoized because the sheet re-renders on EVERY player-context change; with
// a few dozen mounted rows each re-rendering art + gestures, taps stuttered.
// Everything it receives is either row data or a stable ref (context
// callbacks, shared values), so the shallow compare holds.
const Row = React.memo(function Row({
  item,
  index,
  isCurrent,
  isPast,
  rowKey,
  leaving,
  jumpTo,
  reorder,
  onRemove,
  onMoveTop,
  onGone,
  isPick,
  dragFrom,
  dragTo,
  dragShift,
  settling,
  scrollY,
  scrollStart,
  scrollCmd,
  dragDir,
  dirPivot,
  base,
  count,
  baseSV,
  countSV,
  listGesture,
  onDrag,
  fingerY,
  fingerTransY,
  listTop,
}) {
  // __DEV__-only; stripped from release (lib/renderCount).
  countRender('QueueSheet.Row');
  const { t } = useTheme();
  const { width: winW } = useWindowDimensions();
  const title = cleanTitle(item.title);

  const pickup = useCallback(() => {
    Vibration.vibrate(10);
  }, []);

  const a11yActions = useMemo(
    () => [
      { name: 'moveUp', label: 'move up' },
      { name: 'moveDown', label: 'move down' },
      ...(isPick ? [{ name: 'moveToQueue', label: 'move to queue' }] : []),
    ],
    [isPick],
  );
  const onA11yAction = e => {
    const action = e.nativeEvent.actionName;
    if (action === 'moveToQueue') {
      onMoveTop(index);
      AccessibilityInfo.announceForAccessibility(`${title} moved to the queue`);
      return;
    }
    const to = action === 'moveUp' ? index - 1 : index + 1;
    if (to < 0 || to > count - 1) {
      AccessibilityInfo.announceForAccessibility(`${title} is already there`);
      return;
    }
    reorder(index, to);
    AccessibilityInfo.announceForAccessibility(
      `${title} moved ${action === 'moveUp' ? 'up' : 'down'}`,
    );
  };

  const commit = (from, to) => {
    if (from !== to) {
      Vibration.vibrate(8);
    }
    reorder(from, to);
    // Release the drag one frame later so the list paints the new order
    // before rows stop compensating — avoids a one-frame jump-back. The
    // release itself is a SNAP (see rowStyle): the settle in pan.onEnd left
    // every transform at an exact row multiple, so the new data paints in
    // the very positions the eye already sees and zeroing is invisible.
    requestAnimationFrame(() => {
      dragFrom.value = -1;
      dragShift.value = 0;
      settling.value = 0;
    });
  };

  // The storm-off. A removed song takes it personally: a beat of indignation
  // (tiny lean-back and lift), then it wheels off the right edge, drooping
  // and fading as it goes. It plays on the MOUNTED row — never a reanimated
  // exiting animation, which aborts natively if the cell unmounts mid-flight
  // — and only when it's fully out does onGone commit the actual removal
  // (animate-then-commit; the sheet then glides the gap shut).
  const gone = useSharedValue(0);
  useEffect(() => {
    if (!leaving) {
      return;
    }
    gone.value = withSequence(
      withTiming(0.18, { duration: 120, easing: EASE.settle }),
      // Accelerating exit — it left, it didn't park.
      withTiming(1, { duration: 310, easing: Easing.in(Easing.quad) }, done => {
        if (done) {
          runOnJS(onGone)(rowKey);
        }
      }),
    );
  }, [leaving, gone, onGone, rowKey]);

  // A second finger on another grip must not fight over the shared drag
  // slots — first pickup wins, the other pan runs inert.
  const owns = useSharedValue(false);

  const pan = Gesture.Pan()
    // A row mid storm-off can't be picked up — its index is already spoken for.
    .enabled(!leaving)
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
      // The frame loop re-derives the drop target every frame; hand it THIS
      // row's bounds, or it clamps with the queue's and a pick can never
      // land where it was released.
      baseSV.value = base;
      countSV.value = count;
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
    .onEnd((_e, success) => {
      'worklet';
      if (!owns.value || !success) {
        return;
      }
      // Settle the card into its slot BEFORE the data commit. At commit time
      // every compensating transform then sits at an exact multiple of
      // ROW_HEIGHT, so the reorder paints exactly where the eye already sees
      // the rows — the release becomes invisible instead of the 160ms
      // slide-back that read as a glitch after dropping. `settling` also
      // parks the auto-scroll loop: one of its dragShift writes would cancel
      // this timing and the drop would never commit.
      settling.value = 1;
      const slot = (dragTo.value - dragFrom.value) * ROW_HEIGHT;
      dragShift.value = withTiming(
        slot,
        { duration: 110, easing: EASE.settle },
        done => {
          if (done) {
            runOnJS(commit)(dragFrom.value, dragTo.value);
          }
        },
      );
    })
    .onFinalize((_e, success) => {
      'worklet';
      if (!owns.value) {
        return;
      }
      if (!success) {
        // Cancelled drag: glide home (card and shifted neighbours together),
        // then release. dragTo collapsing onto dragFrom zeroes the
        // neighbours' shift targets so everyone returns in the same beat.
        settling.value = 1;
        dragTo.value = dragFrom.value;
        dragShift.value = withTiming(
          0,
          { duration: SHIFT_MS },
          () => {
            dragFrom.value = -1;
            settling.value = 0;
          },
        );
      }
      owns.value = false;
      // Drag over (committed or cancelled) — let the list shed the window.
      runOnJS(onDrag)(false);
    });

  const rowStyle = useAnimatedStyle(() => {
    if (gone.value > 0) {
      return {
        zIndex: 5,
        // Fade late — the character is in the travel, not a dissolve. Past
        // rows fold their static 0.55 in so the exit starts where they sat.
        opacity:
          interpolate(gone.value, [0, 0.55, 1], [1, 0.9, 0]) *
          (isPast ? 0.55 : 1),
        transform: [
          { translateX: interpolate(gone.value, [0, 0.18, 1], [0, -10, winW]) },
          { translateY: interpolate(gone.value, [0, 0.18, 1], [0, -3, 16]) },
          { rotate: `${interpolate(gone.value, [0, 0.18, 1], [0, 1.5, -8])}deg` },
        ],
      };
    }
    if (dragFrom.value === index) {
      return {
        zIndex: 5,
        transform: [{ translateY: dragShift.value }, { scale: 1.01 }],
      };
    }
    if (dragFrom.value < 0) {
      // At rest / on release: plain zeros, NO timing. After a drop the data
      // already sits where the eye left it — animating "back to 0" from the
      // stale compensation was the visible post-drop glitch.
      return {
        zIndex: 0,
        transform: [{ translateY: 0 }, { scale: 1 }],
      };
    }
    let shift = 0;
    if (dragFrom.value < index && index <= dragTo.value) {
      shift = -ROW_HEIGHT;
    } else if (dragTo.value <= index && index < dragFrom.value) {
      shift = ROW_HEIGHT;
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
        // A drag is unusable with a screen reader on, so the same three moves
        // are offered as assistive actions. Exposed ONLY to assistive tech —
        // touch users still have exactly one way in, the drag.
        accessibilityActions={a11yActions}
        onAccessibilityAction={onA11yAction}
        disabled={leaving}
        onPress={() => jumpTo(index)}
        onLongPress={() =>
          openTrackActions({
            track: item,
            // Queue rows: play/queue actions are redundant here (web parity).
            // "move to top" = next-in-line, one press instead of a long drag
            // (docs/perf/04 4a); the current row has nowhere to move.
            menu: {
              omit: ['play', 'playNext', 'addToQueue'],
              extras: isCurrent
                ? []
                : [
                    {
                      icon: 'arrow-up',
                      label: 'Move to top',
                      onPress: () => onMoveTop(index),
                    },
                  ],
            },
          })
        }
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
      >
        {/* Only real queue rows carry a queue position. A suggestion has an
            order but not a slot — numbering it made "1 track" sit above rows
            counting to 10, reading as one long queue. */}
        <Text style={[styles.idx, { color: t.inkFaint }]}>
          {isPick ? '' : String(index + 1).padStart(2, '0')}
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
          disabled={leaving}
          onPress={() => onRemove(rowKey, index)}
          hitSlop={8}
          style={styles.remove}
        >
          <Icon name="close" size={15} color={t.inkFaint} />
        </Pressable>
      )}
    </Animated.View>
  );
});

// The queue overflow menu — web DesktopQueue's ⋯ actions (save / add / clear)
// plus its hide-past header toggle, folded into one bottom sheet. Only the
// queue header opens it, so it keeps local open state instead of a bus; the
// Sheet chassis (zIndex 50) stacks it over the queue (40). "save queue as
// playlist" swaps the menu for an inline name step (the AddToPlaylistSheet
// new-playlist pattern — native has no prompt dialog).
// The divider between the queue and AURA's picks. It lives INSIDE the list,
// so when a drag opens a gap across the boundary it has to shift exactly like
// a row does — a static divider is what let picks slide underneath it and
// collide with the rows above (field report: overlapping tiles). Its virtual
// position is half a slot above the first pick, so the same band test that
// moves the rows moves it too.
const RadioHead = React.memo(function RadioHead({
  boundary,
  dragFrom,
  dragTo,
  inkFaint,
  accent,
  onAdopt,
}) {
  const style = useAnimatedStyle(() => {
    if (dragFrom.value < 0) {
      return { transform: [{ translateY: 0 }] };
    }
    let shift = 0;
    if (dragFrom.value < boundary && boundary <= dragTo.value) {
      shift = -ROW_HEIGHT;
    } else if (dragTo.value <= boundary && boundary < dragFrom.value) {
      shift = ROW_HEIGHT;
    }
    return {
      transform: [{ translateY: withTiming(shift, { duration: SHIFT_MS }) }],
    };
  });
  return (
    <Animated.View style={[styles.radioHeadRow, style]}>
      <Text style={[label(9), { color: inkFaint }]}>
        up next · picked by aura
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="add these songs to your queue"
        onPress={onAdopt}
        hitSlop={8}
      >
        <Text style={[label(9), { color: accent }]}>Add to queue</Text>
      </Pressable>
    </Animated.View>
  );
});

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

  // The house confirm (lib/confirm). Clearing keeps the playing track, so
  // the body says so (web copy).
  const confirmClear = async () => {
    if (
      await confirm({
        title: 'Clear queue?',
        body: "We'll keep the currently playing track.",
        action: 'Clear',
      })
    ) {
      player.clearQueue();
    }
  };

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
      showToast("Couldn't save.");
      setBusy(false);
    }
  };

  // animated={false}: these sheets live under QueueSheet's null gate, which an
  // external queueOpen flip can hard-unmount mid-animation — the reanimated
  // 4.2.3/Fabric native-abort class. That now only skips the EXIT slide; the
  // open is the chassis's shared-value rise, which is safe (and smooth) here.
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
            Saving to {name.trim()}
          </Text>
        ) : (
          <>
            <TextInput
              autoFocus
              accessibilityLabel="playlist name"
              value={name}
              onChangeText={setName}
              onSubmitEditing={saveQueue}
              placeholder="Playlist name"
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
          label="Save queue as playlist"
          onPress={() => setNaming(true)}
        />
      )}
      {tracks.length > 0 && (
        <SheetRow
          icon="queue-add"
          label="Add queue to playlist"
          onPress={act(() => openAddToPlaylist(tracks))}
        />
      )}
      {/* Web gates this behind currentIdx > 0 — with no past songs the toggle
          is a silent no-op. `hidePast` keeps it reachable to switch back off. */}
      {(idx > 0 || hidePast) && (
        <SheetRow
          icon={hidePast ? 'eye' : 'eye-off'}
          label={hidePast ? 'Show past songs' : 'Hide past songs'}
          onPress={act(onToggleHidePast)}
        />
      )}
      {tracks.length > 1 && (
        <>
          <View style={[styles.menuSeparator, { backgroundColor: t.line }]} />
          <SheetRow
            icon="close"
            danger
            label="Clear queue"
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
  // __DEV__-only; stripped from release (lib/renderCount).
  countRender('QueueSheet');
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const player = usePlayer();
  // Stable context callbacks (useCallback in the provider) — handed to the
  // memoized Row directly; passing `player` itself would defeat the memo,
  // since the context value is a fresh object every provider render.
  const {
    jumpTo,
    reorder,
    removeAt,
    adoptAutoNext,
    insertTrackAt,
  } = player;
  // AURA's picks render as ORDINARY rows under their own header (in-place
  // grip — field ask), but they stay SUGGESTIONS: touching one affects only
  // that one. Drag a pick below the header to shuffle the suggestions; drag
  // it up into the queue to insert exactly that track there; ✕ dismisses it;
  // the header's "add to queue" remains the explicit bulk ask. Picks occupy
  // queue-space [len, len+count-1], so drop targets translate by zone.
  const radioBatch = player.autoNextTracks;
  const radioLive = (radioBatch?.length ?? 0) > 0;
  const pickAt = v => {
    const { tracks: qt, radio } = commitRef.current;
    const j = v - qt.length;
    return j >= 0 && j < (radio?.length ?? 0)
      ? { j, track: radio[j] }
      : null;
  };
  const jumpToRow = useCallback(
    v => {
      const p = pickAt(v);
      if (!p) {
        jumpTo(v);
        return;
      }
      // A pick behaves like any queue row: tapping it plays THAT song. It
      // alone joins the queue, right after what's playing — tapping used to
      // haul the whole batch in, which is what made a mis-grabbed drag feel
      // like up next was rewriting the queue.
      const at = commitRef.current.idx + 1;
      insertTrackAt(p.track, at);
      autoRadio.dropCandidate(p.track.id);
      jumpTo(at);
    },

    [jumpTo, insertTrackAt],
  );
  const reorderRow = useCallback(
    (f, to) => {
      const { tracks: qt } = commitRef.current;
      const cur = commitRef.current.idx;
      const from = pickAt(f);
      if (!from) {
        const dest = Math.min(to, qt.length - 1);
        reorder(f, dest);
        // Dragged from ahead of the playhead to behind it — allowed, but it
        // has quietly stopped being something that will play.
        if (f > cur && dest <= cur) {
          showToast(BEHIND_MSG);
        }
        return;
      }
      // The BORDER is the header row, and landing ON it has not crossed it:
      // the tile is still inside up next, so it just becomes the first
      // suggestion — it must not enter the queue (field report: dragging a
      // pick up one slot appended it after the last queued song). Only a
      // drop strictly above the header — genuinely among queue rows — is a
      // crossing. In queue-space that border sits at qt.length - 1, because
      // the header owns a visual slot but no queue index.
      // The divider slot is the LAST queue position, not a dead zone. It
      // shifts down the instant a drag targets it, so the tile is visibly
      // above the divider — i.e. in the queue — and dropping there means
      // "after the last track". Anything below it is still a suggestion.
      // (Field report: only one exact band would drop into the queue, because
      // this boundary sat one slot too high and swallowed the useful target.)
      if (to >= qt.length) {
        // Reorder within up next, exactly like a queue reorder: the dragged
        // pick takes the slot of whichever pick is displayed there.
        const radio = commitRef.current.radio ?? [];
        const k = Math.min(Math.max(0, to - qt.length), radio.length - 1);
        const target = radio[k];
        if (target) {
          autoRadio.moveCandidate(from.track.id, target.id);
        }
      } else {
        // +1: the header row consumed one visual slot on the way up (it owns
        // no queue index), so the raw target would land one position too high
        // (field report: "it is going to past songs"). Where it lands from
        // there is the user's call — above the playhead is legal, it just
        // won't play next, so say so.
        const at = to + 1;
        insertTrackAt(from.track, at);
        autoRadio.dropCandidate(from.track.id);
        if (at <= cur) {
          showToast(BEHIND_MSG);
        }
      }
    },
     
    [reorder, insertTrackAt],
  );
  const onAdoptPicks = useCallback(() => {
    Vibration.vibrate(8);
    adoptAutoNext();
  }, [adoptAutoNext]);
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
  // The row list mounts only after the slide lands (see ListFade) — the
  // chrome rides the spring alone, so the open never drops frames.
  const [landed, setLanded] = useState(false);
  const land = useCallback(() => setLanded(true), []);

  // Layout-animation window: flyMs > 0 arms the list's LinearTransition for a
  // beat, so a data change landing inside the window animates rows to their
  // new slots — a shuffle flies the visible tiles (420ms), a removal glides
  // the gap shut (260ms). Zero otherwise, so it never touches the hand-tuned
  // drag-reorder. Armed synchronously with the mutation so the very render
  // that changes the data is the one that animates.
  const [flyMs, setFlyMs] = useState(0);
  const flyTimer = useRef(null);
  const armFly = useCallback((ms, windowMs) => {
    setFlyMs(ms);
    clearTimeout(flyTimer.current);
    flyTimer.current = setTimeout(() => setFlyMs(0), windowMs);
  }, []);
  const doShuffle = useCallback(() => {
    if (!reduced) {
      armFly(420, 480);
    }
    player.toggleShuffle();
  }, [reduced, armFly, player]);
  useEffect(() => () => clearTimeout(flyTimer.current), []);

  // Overflow menu + the hide-past pref it toggles.
  const [menuOpen, setMenuOpen] = useState(false);
  const [hidePast, setHidePast] = useState(
    () => storage.getItem(HIDE_PAST_KEY) === '1',
  );
  const toggleHidePast = () => {
    const nextHidden = !hidePast;
    // Arm the layout window so the list GROWS or SHRINKS around the past
    // rows instead of snapping — the same 280ms accordion the library
    // shelves use. Without this flyMs stays 0 and the change is instant.
    if (!reduced) {
      armFly(280, 340);
    }
    storage.setItem(HIDE_PAST_KEY, nextHidden ? '1' : '0');
    setHidePast(nextHidden);
  };

  // The list's shape, derived ONCE.
  //
  // Three of these used to be recomputed in the render body below the sheet's
  // early return, and `listData` went straight into the FlatList's `data`.
  // VirtualizedList is a StateSafePureComponent, so a fresh array there is a
  // prop change: the list re-rendered and recomputed its windowing on every
  // render of this sheet, including every play/pause and every stream-url
  // hydration, on the longest list in the app.
  //
  // They share one memo rather than sitting in four because they MUST agree —
  // keyExtractor indexes rowKeys by list position, so a rowKeys built from a
  // different slice than listData mismatches every row. rowKeys already
  // computed this exact sequence privately; now there is one copy.
  //
  // Kept above the early return so the hook order never changes — and now that
  // the derivation is here, renderItem can be a useCallback too.
  const { pastHidden, visible, listData, dragCount, rowKeys } = useMemo(() => {
    // Hide-past renders only the current track onward (web keeps collapsed rows
    // in the DOM; a FlatList just gets the tail slice). Rows keep their ABSOLUTE
    // queue index — jumpTo/removeAt/reorder and the drag math all address the
    // real queue, so the slice only re-bases what's mounted and the model and
    // the native player never see a different numbering.
    const ph = hidePast ? Math.max(0, idx) : 0;
    const rows = ph ? tracks.slice(ph) : tracks;
    // The picks join the SAME list the drag math runs on, under their header
    // row. Queue-space: real rows [0, len-1], picks [len, len+count-1] (the
    // header renders at ROW_HEIGHT but owns no queue index — drops at `len`
    // mean "first suggestion").
    //
    // Suggested rows mint keys from the SAME sequence: if one is pulled into
    // the queue, its key — and therefore its Row instance and any in-flight
    // drag gesture — survives the data swap.
    const live = radioBatch?.length ?? 0;
    const all = live ? [...rows, RADIO_HEAD, ...radioBatch] : rows;
    // Per-track keys (id + occurrence), stable across a reorder — so on shuffle
    // a tile KEEPS its React instance and the layout animation flies it to its
    // new position instead of remounting it in place. (Index-based keys would
    // make every moved tile a "new" one, killing the animation.)
    const seen = Object.create(null);
    const keys = all.map(item => {
      const n = (seen[item.id] = (seen[item.id] ?? 0) + 1);
      return `${item.id}#${n}`;
    });
    return {
      pastHidden: ph,
      visible: rows,
      listData: all,
      dragCount: tracks.length + live,
      rowKeys: keys,
    };
  }, [tracks, idx, hidePast, radioBatch]);

  // Row removal, animate-then-commit: the tapped row joins `leaving` and plays
  // its storm-off in place (Row.gone); only when it has fully left does onGone
  // drop it from the queue, with the fly window armed so the rows below glide
  // up into the gap instead of snapping.
  const [leaving, setLeaving] = useState(() => new Set());
  // The commit re-derives "which absolute index is this row NOW": other
  // removals may have shifted it while the exit played, so a key ("id#nth
  // occurrence", minted over the visible slice) is resolved against the live
  // list at commit time. Splice-synced between commits so back-to-back
  // removals stay correct even before the next render lands.
  const commitRef = useRef({ tracks: [], base: 0, radio: [] });
  commitRef.current = {
    tracks,
    idx,
    base: hidePast ? Math.max(0, idx) : 0,
    radio: radioBatch ?? [],
  };
  const removeRow = useCallback(
    (key, index) => {
      if (reduced) {
        const p = pickAt(index);
        if (p) {
          autoRadio.dropCandidate(p.track.id);
        } else {
          removeAt(index);
        }
        return;
      }
      setLeaving(prev => (prev.has(key) ? prev : new Set(prev).add(key)));
    },
     
    [reduced, removeAt],
  );
  // "move to top" = next in line, right after the playing track. Splice
  // semantics shift the current index down by one when the row comes from
  // above it, so the insert target differs by side (docs/perf/04 4a).
  const moveToTop = useCallback(
    i => {
      // commitRef, not `idx` — see the deps below.
      const cur = commitRef.current.idx;
      const p = pickAt(i);
      if (p) {
        // This pick alone becomes next in line; the batch keeps the rest.
        insertTrackAt(p.track, cur + 1);
        autoRadio.dropCandidate(p.track.id);
        return;
      }
      if (i === cur) {
        return;
      }
      reorder(i, i > cur ? cur + 1 : cur);
    },
    // `idx` is deliberately NOT a dependency. It changes on every track
    // advance, and this callback is handed to every mounted Row — so depending
    // on it re-rendered the whole visible queue each time a song changed,
    // straight through Row's React.memo. Its two siblings jumpToRow and
    // reorderRow already read the playhead off commitRef for exactly this
    // reason; this one was the outlier.
    [reorder, insertTrackAt],
  );
  const onGone = useCallback(
    key => {
      setLeaving(prev => {
        if (!prev.has(key)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      const cut = key.lastIndexOf('#');
      const id = key.slice(0, cut);
      const nth = Number(key.slice(cut + 1));
      const { tracks: list, base } = commitRef.current;
      let seen = 0;
      for (let i = base; i < list.length; i += 1) {
        if (list[i].id !== id) {
          continue;
        }
        seen += 1;
        if (seen === nth) {
          commitRef.current = {
            ...commitRef.current,
            tracks: list.slice(0, i).concat(list.slice(i + 1)),
            base,
          };
          armFly(260, 340);
          removeAt(i);
          return;
        }
      }
      // Not in the queue — a dismissed PICK: drop it from the suggestion
      // batch (and its cache) so it stays gone across reopens.
      const radio = commitRef.current.radio ?? [];
      if (radio.some(x => x.id === id)) {
        commitRef.current = {
          ...commitRef.current,
          radio: radio.filter(x => x.id !== id),
        };
        armFly(260, 340);
        autoRadio.dropCandidate(id);
      }
    },
    [armFly, removeAt],
  );

  const endClose = useCallback(() => setVis('closed'), []);

  useEffect(() => {
    if (open && vis === 'closed') {
      dragY.value = 0;
      if (reduced) {
        slide.value = 0;
        setLanded(true);
      } else {
        slide.value = winH;
        setLanded(false);
        slide.value = withSpring(0, SPRING.sheet, done => {
          if (done) {
            runOnJS(land)();
          }
        });
      }
      setVis('open');
    }
    // Closed from outside the sheet (sign-out) — resync the mount machine so
    // the next open still gets its slide-in.
    if (!open && vis === 'open') {
      setVis('closed');
      setMenuOpen(false);
    }
  }, [open, vis, reduced, winH, slide, dragY, land]);

  const close = useCallback(() => {
    if (vis === 'closing') {
      return;
    }
    setVis('closing');
    setMenuOpen(false);
    // Removals still animating lose their exit here (the cells unmount with
    // the sheet, cancelling the timing before its commit) — flush them now so
    // a tapped ✕ always lands.
    leaving.forEach(k => onGone(k));
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
  }, [vis, reduced, endClose, player.ui, winH, slide, leaving, onGone]);

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
  // 1 while a drop (or cancel) is settling into its slot — parks the
  // auto-scroll loop so its dragShift writes can't cancel the settle timing.
  const settling = useSharedValue(0);
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
    // Rest-state bounds only. A drag OWNS these while it runs — the row that
    // was picked up writes its own bounds in onStart, because up-next picks
    // live past the end of the queue and this rest value would clamp every
    // drop back into the queue's range (field report: nothing could be
    // reordered or dropped; every commit logged to=0 on a 1-track queue).
    if (dragFrom.value !== -1) {
      return;
    }
    baseSV.value = hidePast ? Math.max(0, idx) : 0;
    countSV.value = tracks.length;
    // dragFrom is a shared value read imperatively as a guard — it is not a
    // reactive dependency, and listing it would re-run this on every drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidePast, idx, tracks.length, baseSV, countSV]);

  // Continuous auto-scroll: runs every frame while a drag is active (not tied
  // to finger-move events, so it keeps going when the finger holds at the edge)
  // and ramps speed quadratically with edge depth. It also re-derives the
  // drag-follow offset + drop target each frame so a still finger still advances
  // the slot as the list scrolls beneath it.
  const autoScroll = useFrameCallback(frame => {
    'worklet';
    if (dragFrom.value < 0 || settling.value === 1) {
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

  const renderItem = useCallback(({ item, index }) => {
    if (item.__radioHead) {
      return (
        <RadioHead
          boundary={tracks.length - 0.5}
          dragFrom={dragFrom}
          dragTo={dragTo}
          inkFaint={t.inkFaint}
          accent={t.accent}
          onAdopt={onAdoptPicks}
        />
      );
    }
    // Picks sit one list slot below their queue-space index (the header row).
    const at =
      index + pastHidden - (radioLive && index > visible.length ? 1 : 0);
    const key = rowKeys[index];
    return (
      <Row
        item={item}
        index={at}
        isCurrent={at === idx}
        isPast={at < idx}
        rowKey={key}
        leaving={leaving.has(key)}
        jumpTo={jumpToRow}
        onMoveTop={moveToTop}
        reorder={reorderRow}
        onRemove={removeRow}
        onGone={onGone}
        dragFrom={dragFrom}
        dragTo={dragTo}
        dragShift={dragShift}
        settling={settling}
        scrollY={scrollY}
        scrollStart={scrollStart}
        scrollCmd={scrollCmd}
        dragDir={dragDir}
        dirPivot={dirPivot}
        isPick={at >= tracks.length}
        // A pick sits one VISUAL slot below its queue index (the header row
        // between the sections owns no index), so its base carries that
        // offset: it keeps the pickup geometry honest, and it lets the drop
        // target reach -1 — which is +1'd back to 0, the slot above the first
        // track. Without it the very top of the queue is unreachable.
        base={pastHidden - (at >= tracks.length ? 1 : 0)}
        count={at >= tracks.length ? dragCount : tracks.length}
        baseSV={baseSV}
        countSV={countSV}
        listGesture={listGesture}
        onDrag={onDrag}
        fingerY={fingerY}
        fingerTransY={fingerTransY}
        listTop={listTop}
      />
    );
    // Deliberately NOT depending on the player context value: it takes a new
    // identity on every play/pause and every stream-url hydration, none of
    // which changes a row. What is left moves only when the list genuinely
    // does. The shared values are refs and never change identity.
  }, [
    tracks.length, idx, pastHidden, visible.length, rowKeys, radioLive,
    leaving, dragCount, jumpToRow, moveToTop, reorderRow, removeRow, onGone,
    onAdoptPicks, onDrag, listGesture, t.inkFaint, t.accent,
    dragFrom, dragTo, dragShift, settling, scrollY, scrollStart, scrollCmd,
    dragDir, dirPivot, baseSV, countSV, fingerY, fingerTransY, listTop,
  ]);

  // Indexes the SAME sequence listData is built from — they come out of one
  // memo above precisely so they cannot disagree.
  const keyForRow = useCallback((_item, index) => rowKeys[index], [rowKeys]);

  // The picks' header renders IN the list (see RADIO_HEAD in renderItem).

  // Everything above is a hook, so the sheet's early exit has to come after
  // them — bailing sooner would change the hook order between renders.
  if (!open && vis !== 'closing') {
    return null;
  }

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
                  player.shuffleActive ? 'Shuffle off' : 'Shuffle'
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
            Nothing queued yet — play something first.
          </Text>
        ) : landed ? (
          <ListFade reduced={reduced}>
          <GestureDetector gesture={listGesture}>
            <Animated.FlatList
              ref={listRef}
              data={listData}
              renderItem={renderItem}
              keyExtractor={keyForRow}
              // Mounted at REST so reanimated is already tracking each cell's
              // position when a data change lands (arming it only on that
              // render is too late — the "before" layout was never captured);
              // the duration is 0 except inside an armed fly window (shuffle
              // flight / removal collapse), so rows animate to their slots
              // then and snap instantly otherwise.
              // But it is fully DETACHED during an active drag: the manual
              // drag-reorder owns every pixel of its motion through explicit
              // transforms, and a live layout animation — even at duration 0 the
              // machinery still runs a per-cell layout pass every frame — fights
              // the auto-scroll near the edges and jitters the rows (the "shake"
              // when dragging a song to the bottom). undefined ⇒ plain cells
              // while dragging; it re-attaches on drop, in time for the shuffle.
              itemLayoutAnimation={
                dragging ? undefined : LinearTransition.duration(flyMs)
              }
              getItemLayout={ROW_LAYOUT}
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
          <DropLine
            accent={t.accent}
            dragFrom={dragFrom}
            dragTo={dragTo}
            baseSV={baseSV}
            scrollY={scrollY}
          />
          </ListFade>
        ) : null}
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
    fontFamily: fonts.semibold,
    fontSize: 17,
  },
  count: {
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  toggle: {
    paddingHorizontal: 6,
  },
  list: {
    paddingHorizontal: 10,
    paddingTop: LIST_TOP_PAD,
  },
  listFade: { flex: 1 },
  dropLine: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 0,
    height: 2,
    borderRadius: 1,
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
  // The in-list "up next · picked by aura" header — exactly ROW_HEIGHT so
  // the fixed-height drag math stays uniform around it.
  radioHeadRow: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingBottom: 10,
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
    fontFamily: fonts.regular,
    fontSize: 11,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  meta: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontFamily: fonts.medium,
    fontSize: 14.5,
  },
  artist: {
    fontFamily: fonts.regular,
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
    fontFamily: fonts.regular,
    fontSize: 11.5,
    fontVariant: ['tabular-nums'],
  },
  remove: {
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  empty: {
    fontFamily: fonts.regular,
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
