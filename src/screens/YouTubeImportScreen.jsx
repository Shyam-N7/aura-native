import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  Easing,
  LinearTransition,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BounceScrollView } from '../components/ui/Bounce';
import { DOCK_CLEARANCE } from '../components/nav/Dock';
import { CrumbBack } from '../components/detail/DetailChassis';
import { CountUp } from '../components/ui/CountUp';
import { PressScale } from '../components/ui/PressScale';
import { useAppActive } from '../hooks/useAppActive';
import { useNavFocused } from '../hooks/useNavFocused';
import { fmtTime } from '../utils/fmtTime';
import { artUrl } from '../utils/artUrl';
import { DUR, EASE, SPRING } from '../theme/motion';
import { useTheme } from '../theme/ThemeContext';
import { previewLink, startImport, cancelImport } from '../api/ytImport';
import { useImportJob, progressOf } from '../hooks/useImportJob';
import { COPY, copyForCode, isRetryable } from '../lib/ytImportCopy';
import { YouTubeReview } from '../overlays/YouTubeReview';
import { confirm } from '../lib/confirm';
import { fonts, label, type } from '../theme/tokens';

// Paste a YouTube link, get an AURA playlist.
// Ported from web src/screens/YouTubeImportScreen.jsx.
//
// Four states in ONE screen rather than four screens, because they are one
// continuous action and the user should never feel handed off:
//
//   paste ──preview──▶ confirm ──start──▶ progress ──▶ done ──▶ (review)
//
// Every string comes from ../lib/ytImportCopy. There are deliberately no
// literals below: that file carries the server's error codes, so a new code
// cannot reach a user as "something went wrong".

const PLACEHOLDER_ROWS = 6;
const DEBOUNCE_MS = 350;

export default function YouTubeImportScreen({ navigation }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState(null);
  const [checking, setChecking] = useState(false);
  const [linkError, setLinkError] = useState(null);
  const [starting, setStarting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const {
    job,
    setJob,
    error: pollError,
    stop,
    live,
    stalled,
    resume,
  } = useImportJob(null);
  const inputRef = useRef(null);

  // Clearing the previous verdict belongs to the EDIT, not to the effect that
  // fetches the next one: what invalidates the old answer is the user changing
  // the link.
  const changeUrl = next => {
    setUrl(next);
    setPreview(null);
    setLinkError(null);
  };

  // Check the link as it is pasted. On Android a paste arrives as one
  // onChangeText, so unlike the web this debounce is not about paste chunking —
  // it is for a URL typed by hand, which would otherwise be checked on every
  // keystroke. The endpoint is free server-side; the flicker is not free to read.
  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed) {
      return undefined;
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      setChecking(true);
      previewLink(trimmed, { signal: ctl.signal })
        .then(setPreview)
        .catch(err => {
          if (err.name !== 'AbortError') {
            setLinkError(err);
          }
        })
        .finally(() => setChecking(false));
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [url]);

  // A verdict has landed and the decision moves to the buttons — on a short
  // phone the keyboard would otherwise sit on top of them.
  useEffect(() => {
    if (preview) {
      Keyboard.dismiss();
    }
  }, [preview]);

  const begin = async () => {
    Keyboard.dismiss();
    setStarting(true);
    try {
      setJob(await startImport(url.trim()));
    } catch (err) {
      setLinkError(err);
    } finally {
      setStarting(false);
    }
  };

  // ── The streaming handoff ──────────────────────────────────────────
  //
  // Once the server has created the playlist mid-import (playlistId non-null
  // while still live) and it holds enough songs to be worth opening, the pill
  // appears — and, for a user who is actually watching, a 3s timer walks them
  // in on its own. The timer is a JS setTimeout, never an animation callback:
  // it must fire under reduced motion too. Latched: flickers of the gate
  // (counts wobbling across a poll) must not re-arm a cancelled timer.
  const [handoff, setHandoff] = useState(false);
  const [autoOpening, setAutoOpening] = useState(false);
  const autoTimerRef = useRef(null);
  const sweep = useSharedValue(0);
  const screenActive = useAppActive();
  const screenFocused = useNavFocused();
  const reducedHere = useReducedMotion();

  const openEarly = useCallback(() => {
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    // replace, not navigate: the import screen's job is done the moment the
    // playlist takes over as the streaming surface — and replace unmounts
    // this screen, which stops its poll; the playlist screen's hook becomes
    // the worker with no overlap.
    const p = jobRef.current;
    if (p?.playlistId) {
      navigation.replace('Playlist', {
        id: String(p.playlistId),
        importJobId: String(p.id),
      });
    }
  }, [navigation]);

  const cancelAutoOpen = useCallback(() => {
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    cancelAnimation(sweep);
    sweep.value = 0;
    setAutoOpening(false);
  }, [sweep]);

  // jobRef: openEarly fires from a timer; it must read the CURRENT job, not
  // the one closed over when the timer armed.
  const jobRef = useRef(null);
  jobRef.current = job;

  const handoffReady =
    live && !!job?.playlistId && (job?.counts?.auto ?? 0) >= 10;
  useEffect(() => {
    if (!handoffReady || handoff) {
      return;
    }
    setHandoff(true);
    // Auto-open only when actually being watched — a user who parked the
    // screen must not be teleported on return. No restart either: coming back
    // finds the pill waiting, which is the calmer promise.
    if (screenActive && screenFocused) {
      setAutoOpening(true);
      if (!reducedHere) {
        sweep.value = withTiming(1, { duration: 3000, easing: Easing.linear });
      }
      autoTimerRef.current = setTimeout(openEarly, 3000);
    }
  }, [handoffReady, handoff, screenActive, screenFocused, reducedHere, sweep, openEarly]);

  // Leaving or backgrounding mid-countdown cancels it.
  useEffect(() => {
    if (autoOpening && !(screenActive && screenFocused)) {
      cancelAutoOpen();
    }
  }, [autoOpening, screenActive, screenFocused, cancelAutoOpen]);

  useEffect(() => () => {
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current);
    }
  }, []);

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: sweep.value }],
  }));

  const abandon = async () => {
    const ok = await confirm({
      title: COPY.cancel.confirm,
      // Once the playlist exists mid-import, cancelling keeps it (server
      // behaviour since the first cut) — the sheet must say so, or "stop"
      // reads as "throw away what arrived".
      body: job?.playlistId
        ? `${COPY.cancel.body} ${COPY.progress.cancelKeeps}`
        : COPY.cancel.body,
      action: COPY.cancel.stop,
      danger: true,
    });
    if (!ok) {
      return;
    }
    stop();
    try {
      await cancelImport(job.id);
    } catch {
      /* already finished — nothing to undo */
    }
    navigation.goBack();
  };

  // Hardware back during a live import. On a stack screen the navigator handles
  // back itself and would pop straight out — no confirm, no cancel — and since
  // popping unmounts the hook, that stops the drain with the only recovery a
  // cron that runs once a day. Registered here so it runs before the
  // navigator's (RN dispatches in reverse registration order). Same pattern as
  // ui/Sheet.jsx:84.
  useEffect(() => {
    if (!live) {
      return undefined;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      abandon();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, job?.id]);

  const open = () => {
    if (job?.playlistId) {
      // replace, not navigate: a finished import has nothing to come back to,
      // and this puts back on the playlists list the user started from.
      navigation.replace('Playlist', { id: job.playlistId });
    } else {
      navigation.goBack();
    }
  };

  if (reviewing && job) {
    return (
      <YouTubeReview
        job={job}
        onDone={updated => {
          if (updated) {
            setJob(updated);
          }
          setReviewing(false);
        }}
        onOpenPlaylist={id => navigation.replace('Playlist', { id })}
      />
    );
  }

  const phase = !job
    ? preview
      ? 'confirm'
      : 'paste'
    : live
    ? 'progress'
    : job.status === 'failed'
    ? 'failed'
    : 'done';

  return (
    <View
      style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}
    >
      <BounceScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + DOCK_CLEARANCE },
        ]}
        keyboardDismissMode="on-drag"
        // Without this the first tap on "import" only dismisses the keyboard.
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        // Any touch cancels a pending auto-open: the user reached for the
        // screen, so the screen stops deciding for them. The pill stays.
        onTouchStart={autoOpening ? cancelAutoOpen : undefined}
      >
        <View style={styles.head}>
          <CrumbBack onPress={() => (live ? abandon() : navigation.goBack())} />
          {live && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={COPY.cancel.action}
              onPress={abandon}
              hitSlop={8}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Text style={[styles.quietAction, { color: t.inkSoft }]}>
                {COPY.cancel.action}
              </Text>
            </Pressable>
          )}
        </View>

        <Text style={[label(9.5), { color: t.inkFaint }]}>
          {COPY.entry.label}
        </Text>
        {/* One line, not the web's serif/italic two-liner: this app has a single
            typeface with no italic face (tokens.js — the filename IS the weight). */}
        <Text style={[type.queueHero, styles.hero, { color: t.ink }]}>
          from youtube.
        </Text>

        <PhaseBody
          phase={phase}
          render={shown => (
            <>
              {shown === 'paste' && (
                <PasteState
                  url={url}
                  setUrl={changeUrl}
                  inputRef={inputRef}
                  checking={checking}
                  linkError={linkError}
                />
              )}

              {shown === 'confirm' && (
                <ConfirmState
                  preview={preview}
                  starting={starting}
                  linkError={linkError}
                  onBack={() => changeUrl('')}
                  onStart={begin}
                />
              )}

              {shown === 'progress' && (
                <ProgressState
                  job={job}
                  pollError={pollError}
                  stalled={stalled}
                  onResume={resume}
                  pill={{
                    show: handoff && live,
                    autoOpening,
                    sweepStyle,
                    onPress: openEarly,
                  }}
                />
              )}

              {shown === 'failed' && (
                <FailedState
                  job={job}
                  onRetry={() => {
                    setJob(null);
                    changeUrl('');
                  }}
                  onClose={() => navigation.goBack()}
                />
              )}

              {shown === 'done' && (
                <DoneState
                  job={job}
                  onReview={() => setReviewing(true)}
                  onOpen={open}
                  onLater={() => navigation.goBack()}
                />
              )}
            </>
          )}
        />
      </BounceScrollView>
    </View>
  );
}

// Each state RISES IN when the flow reaches it: content swaps immediately and
// only the entrance animates. Deliberately not a full crossfade — holding the
// old phase on screen behind an animation callback means 120ms of stale
// content, a runOnJS, and a completion callback that can race teardown, all to
// animate an exit nobody is looking at. Manual shared values, not
// entering=/exiting= (the reanimated/Fabric abort class documented on
// Shelf.jsx — this screen is torn down mid-flight by design). A child
// component, so the screen's hook order is untouched by its early return into
// review.
function PhaseBody({ phase, render }) {
  const reduced = useReducedMotion();
  const v = useSharedValue(1);
  const prev = useRef(phase);
  useEffect(() => {
    if (prev.current === phase) {
      return undefined;
    }
    prev.current = phase;
    if (reduced) {
      v.value = 1;
      return undefined;
    }
    v.value = 0;
    v.value = withTiming(1, { duration: 320, easing: EASE.settle });
    return () => cancelAnimation(v);
  }, [phase, reduced, v]);
  const style = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ translateY: (1 - v.value) * 10 }],
  }));
  return (
    <Animated.View style={[styles.phaseBody, style]}>
      {render(phase)}
    </Animated.View>
  );
}

// One summary line rising into place, slightly after the one above it — the
// SensingScreen reveal, done with opacity so the text is in the tree from the
// first frame (a conditional mount would hide copy from anyone — or any test —
// reading the screen immediately).
function StaggerIn({ delay, children }) {
  const reduced = useReducedMotion();
  const v = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) {
      v.value = 1;
      return undefined;
    }
    v.value = withDelay(
      delay,
      withTiming(1, { duration: DUR.screen, easing: EASE.enter }),
    );
    return () => cancelAnimation(v);
  }, [delay, reduced, v]);
  const style = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ translateY: (1 - v.value) * 8 }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

function Note({ title, body, warn }) {
  const { t } = useTheme();
  return (
    <View
      style={[
        styles.note,
        { backgroundColor: t.surface },
        warn && styles.noteWarn,
        warn && { borderLeftColor: t.accent },
      ]}
    >
      {title ? (
        <Text style={[styles.noteTitle, { color: t.ink }]}>{title}</Text>
      ) : null}
      {body ? (
        <Text style={[styles.noteBody, { color: t.inkSoft }]}>{body}</Text>
      ) : null}
    </View>
  );
}

function PasteState({ url, setUrl, inputRef, checking, linkError }) {
  const { t } = useTheme();
  const err = linkError && copyForCode(linkError.code, linkError.message);
  return (
    <>
      {/* autoFocus is load-bearing, not polish: this app has no clipboard
          library and no Expo, so the OS long-press paste bubble on a focused
          input is the ONLY paste affordance the feature has. */}
      <TextInput
        ref={inputRef}
        autoFocus
        value={url}
        onChangeText={setUrl}
        placeholder={COPY.paste.placeholder}
        placeholderTextColor={t.inkFaint}
        cursorColor={t.accent}
        selectionColor={t.accent}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        keyboardType="url"
        returnKeyType="go"
        accessibilityLabel={COPY.paste.placeholder}
        style={[
          styles.input,
          { color: t.ink, borderColor: t.line, backgroundColor: t.surface },
        ]}
      />
      <Text style={[styles.hint, { color: t.inkSoft }]}>{COPY.entry.hint}</Text>
      {checking && (
        <Text style={[label(8.5), { color: t.inkFaint }]}>
          {COPY.paste.checking}
        </Text>
      )}
      {err && <Note title={err.title} body={err.body} warn />}
      {/* Empty rows standing in for the songs about to arrive. Not decoration:
          it makes the shape of the result legible before anything is fetched,
          so the progress state that follows isn't a surprise layout. */}
      <View style={styles.ghosts} pointerEvents="none">
        {Array.from({ length: PLACEHOLDER_ROWS }, (_, i) => (
          <View
            key={i}
            style={[
              styles.ghost,
              { backgroundColor: t.surface, opacity: 1 - i * 0.14 },
            ]}
          />
        ))}
      </View>
    </>
  );
}

function ConfirmState({ preview, starting, linkError, onBack, onStart }) {
  const { t } = useTheme();
  const err = linkError && copyForCode(linkError.code, linkError.message);
  return (
    <>
      {/* The honest framing has to land HERE. A mix regenerates every time
          YouTube builds it, so what we take is a snapshot — said before the
          user commits, it is information; said afterwards, it is an excuse. */}
      <Note
        body={
          preview.windowed
            ? COPY.confirm.mix(preview.windowSize)
            : COPY.confirm.playlist(null)
        }
      />
      {err && <Note title={err.title} body={err.body} warn />}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={COPY.confirm.cancel}
          disabled={starting}
          onPress={onBack}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Text style={[styles.quietAction, { color: t.inkSoft }]}>
            {COPY.confirm.cancel}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={COPY.confirm.action}
          disabled={starting}
          onPress={onStart}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Text
            style={[
              styles.goAction,
              { color: starting ? t.inkFaint : t.accent },
            ]}
          >
            {starting ? COPY.paste.checking : COPY.confirm.action}
          </Text>
        </Pressable>
      </View>
    </>
  );
}

// How many songs the live list shows at once, and how many of them sit BEHIND
// the one being matched. Deliberately small: this is a window that follows the
// work, not the whole tracklist. Rendering all N rows looks right for ten
// seconds and then the frontier scrolls under the fold and the screen goes
// static again — which is the problem this feature exists to fix. Auto-scrolling
// instead would fight the user's thumb. A sliding window needs neither.
const WINDOW_ROWS = 8;
const WINDOW_BEHIND = 3;

// The song the server is on right now.
//
// Not an estimate. matchPhase claims items with ORDER BY position ASC LIMIT 1,
// so the queue drains strictly in order: everything above the first
// tier-less item is finished and everything below it is waiting. That is a fact
// about the server's cursor, which is the only reason it is honest to put a
// song title on screen and say we are working on it.
function frontierIndex(items) {
  const i = items.findIndex(it => !it.tier);
  return i === -1 ? items.length : i;
}

function rowStatus(item, isFrontier) {
  if (isFrontier) {
    return { text: COPY.progress.row.working, tone: 'accent' };
  }
  if (!item.tier) {
    return null; // still waiting — say nothing rather than something empty
  }
  if (item.tier === 'auto') {
    return { text: COPY.progress.row.matched, tone: 'soft' };
  }
  if (item.tier === 'review') {
    return { text: COPY.progress.row.review, tone: 'soft' };
  }
  return { text: COPY.progress.row.missing, tone: 'faint' };
}

// The window slides by one row whenever the frontier crosses WINDOW_BEHIND.
// Without this that is a teleport. Same idiom as LikedScreen.jsx:34 — and
// deliberately NO `entering={FadeIn}`: Shelf.jsx documents the reanimated
// 4.2.3/Fabric native-abort class for entering animations on a tree the
// navigator can tear down mid-flight, and this screen is torn down mid-flight
// BY DESIGN (abandon() → goBack()).
const ROW_LAYOUT = LinearTransition.duration(280).reduceMotion(
  ReduceMotion.System,
);

// A resolved row's art disc pops in once — a one-shot, so no gating needed.
function ArtDisc({ uri }) {
  const v = useSharedValue(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    v.value = reduced
      ? 1
      : withTiming(1, { duration: DUR.upNext, easing: EASE.enter });
    return () => cancelAnimation(v);
  }, [v, reduced]);
  const style = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ scale: 0.6 + v.value * 0.4 }],
  }));
  return (
    <Animated.View style={style}>
      <Image source={{ uri }} style={styles.rowArt} />
    </Animated.View>
  );
}

function ImportRow({ item, isFrontier, waiting, pulse }) {
  const { t } = useTheme();
  const status = rowStatus(item, isFrontier);
  const tone =
    status?.tone === 'accent'
      ? t.accent
      : status?.tone === 'faint'
      ? t.inkFaint
      : t.inkSoft;
  // One shared value for the whole list, owned by the parent — only ever one
  // frontier, and a per-row value would churn as the window slides.
  const dotStyle = useAnimatedStyle(() => ({
    opacity: 0.3 + pulse.value * 0.7,
    transform: [{ scale: 0.85 + pulse.value * 0.3 }],
  }));
  // The winning track's cover, where the row carries one — fresh matches do,
  // cache hits store candidates: null and keep the dot. The window becomes a
  // strip of real album art: the playlist visibly assembling.
  const art = !waiting && !isFrontier && item.candidates?.[0]?.imageUrl;
  return (
    <Animated.View
      layout={ROW_LAYOUT}
      style={[styles.row, waiting && styles.rowWaiting]}
    >
      {/* Fixed-width gutter so the frontier advancing causes no horizontal
          jitter in the titles beside it. */}
      <View style={styles.gutter}>
        {isFrontier ? (
          <Animated.View
            style={[styles.dotNow, { backgroundColor: t.accent }, dotStyle]}
          />
        ) : waiting ? null : art ? (
          <ArtDisc uri={artUrl(item.candidates[0], 150)} />
        ) : (
          <View style={[styles.dotDone, { backgroundColor: t.inkFaint }]} />
        )}
      </View>
      <Text
        numberOfLines={1}
        style={[
          styles.rowTitle,
          { color: isFrontier ? t.ink : waiting ? t.inkFaint : t.inkSoft },
        ]}
      >
        {/* YouTube's own name for it, warts and all. Swapping in the catalog's
            cleaner title once a row resolves would make rows appear to rewrite
            themselves mid-import, which reads as a glitch. */}
        {item.youtube?.title ?? ''}
      </Text>
      {status && (
        <Text style={[label(8), styles.rowStatus, { color: tone }]}>
          {status.text}
        </Text>
      )}
    </Animated.View>
  );
}

/**
 * The item the reveal card should show: the most recently RESOLVED item that
 * actually carries its winner (fresh matches store candidates[0] — the catalog
 * track's title, artist and art; cache hits store null).
 *
 * Deterministic on purpose: scan backwards from the frontier and take the
 * highest-position row with a candidate. The card re-animates only when this
 * item's id changes, and renders nothing at all before one exists — an empty
 * shell, or a stale card dressed as news, would both be worse than absence.
 */
export function revealItem(items) {
  const at = frontierIndex(items);
  for (let i = at - 1; i >= 0; i--) {
    if (items[i]?.tier && items[i].tier !== 'unmatched' && items[i].candidates?.[0]) {
      return items[i];
    }
  }
  return null;
}

// What the last song BECAME: art, clean catalog identity, and the messy
// YouTube title underneath — the before and after of the entire feature,
// updating live as the drain works. This is the data the screen used to throw
// away while printing "added".
function RevealCard({ item }) {
  const { t } = useTheme();
  const reduced = useReducedMotion();
  const v = useSharedValue(1);
  const artPop = useSharedValue(1);
  const shownId = useRef(item.id);
  // Manual swap, not entering=/exiting= (the reanimated/Fabric abort class
  // documented on Shelf.jsx — this screen is torn down mid-flight by design).
  // Each new match is a small WIN, and the card says so: the content rises,
  // the art lands with a snapback overshoot, an accent ring blooms out behind
  // it, and a soft accent wash fades off the card. All one-shots driven by
  // real arrivals — the celebration is event-driven even though the idle
  // scene above breathes on a clock.
  useEffect(() => {
    if (shownId.current === item.id) {
      return undefined;
    }
    shownId.current = item.id;
    if (reduced) {
      v.value = 1;
      artPop.value = 1;
      return undefined;
    }
    v.value = 0;
    v.value = withTiming(1, { duration: DUR.upNext, easing: EASE.enter });
    artPop.value = 0.82;
    artPop.value = withSpring(1, SPRING.snapback);
    return () => {
      cancelAnimation(v);
      cancelAnimation(artPop);
    };
  }, [item.id, reduced, v, artPop]);
  const style = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ translateY: (1 - v.value) * 6 }],
  }));
  const artStyle = useAnimatedStyle(() => ({
    transform: [{ scale: artPop.value }],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: (1 - v.value) * 0.9,
    transform: [{ scale: 0.7 + v.value * 0.8 }],
  }));
  const washStyle = useAnimatedStyle(() => ({
    opacity: (1 - v.value) * 0.6,
  }));
  const c = item.candidates[0];
  const review = item.tier === 'review';
  return (
    <Animated.View
      style={[styles.reveal, { backgroundColor: t.surface }, style]}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.revealWash, { backgroundColor: t.accentSoft }, washStyle]}
      />
      <Animated.View style={artStyle}>
        <Animated.View
          pointerEvents="none"
          style={[styles.revealRing, { borderColor: t.accent }, ringStyle]}
        />
        {c.imageUrl ? (
          <Image source={{ uri: artUrl(c, 150) }} style={styles.revealArt} />
        ) : (
          <View
            style={[
              styles.revealArt,
              styles.revealArtFallback,
              { backgroundColor: t.accentSoft },
            ]}
          >
            <Text style={[styles.revealLetter, { color: t.accent }]}>
              {c.title?.[0]?.toUpperCase() ?? '·'}
            </Text>
          </View>
        )}
      </Animated.View>
      <View style={styles.revealMeta}>
        <Text style={[label(7.5), { color: review ? t.accent : t.inkFaint }]}>
          {review ? COPY.progress.row.review : COPY.progress.found}
        </Text>
        <Text numberOfLines={1} style={[styles.revealTitle, { color: t.ink }]}>
          {c.title}
        </Text>
        {!!c.artist && (
          <Text
            numberOfLines={1}
            style={[styles.revealArtist, { color: t.inkSoft }]}
          >
            {c.artist}
          </Text>
        )}
        <Text numberOfLines={1} style={[styles.revealWas, { color: t.inkFaint }]}>
          {COPY.progress.was(item.youtube?.title ?? '')}
        </Text>
      </View>
    </Animated.View>
  );
}

/**
 * Which of the four stages this job is in. One place, because the stage line
 * and the rotating word must never disagree about it.
 */
export function phaseOf(job) {
  const { total, pct } = progressOf(job);
  if (job?.status === 'queued') {
    return 'queued';
  }
  if (job?.status === 'fetching' || total === 0) {
    return 'fetching';
  }
  return (job?.counts?.matching ?? 0) <= 3 || pct >= 90 ? 'closing' : 'matching';
}

function ProgressState({ job, pollError, stalled, onResume, pill }) {
  const { t } = useTheme();
  const { done, total, pct } = progressOf(job);
  const items = job.items ?? [];
  const phase = phaseOf(job);

  // The stage line: countable, and the only thing here that claims progress.
  const line =
    phase === 'queued'
      ? COPY.progress.starting
      : phase === 'fetching'
      ? COPY.progress.fetching
      : phase === 'closing'
      ? COPY.progress.almostThere(done, total)
      : COPY.progress.matching(done, total);

  // The rotating word underneath, advanced by the POLL rather than by a clock.
  //
  // That distinction is the whole design. The poll IS the server's worker, so a
  // new job object is proof a slice of matching just ran — an advancing word is
  // evidence of work, which no timer could honestly claim. It also means a hung
  // poll or a stalled job freezes the word exactly where it is, beside the note
  // explaining why, with no special case anywhere. (A setInterval here would be
  // the obvious implementation and would cheerfully cycle through a dead drain.)
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    setTurn(n => n + 1);
  }, [job]);
  const pool = COPY.progress.words[phase] ?? COPY.progress.words.matching;
  const word = pool[turn % pool.length];

  // How long this has been going. Recomputed from a stored start rather than
  // accumulated, so backgrounding and coming back shows the right total with no
  // drift and no catch-up. It is also the one thing that keeps moving during a
  // stall, which is right — "this has been going 6:20" is the information that
  // makes the "keep checking" button worth pressing.
  const startedAt = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, []);

  // Glide the bar rather than snapping it. scaleX, never width:'<pct>%' —
  // percentage width cannot run on the UI thread and forces a layout pass per
  // frame. 900ms against a 2s poll means the bar is moving for nearly half of
  // every otherwise-dead interval, and the glide IS the reveal.
  const reduced = useReducedMotion();
  const fill = useSharedValue(0);
  useEffect(() => {
    const to = Math.max(0, Math.min(1, pct / 100));
    if (reduced) {
      fill.value = to;
      return undefined;
    }
    fill.value = withTiming(to, {
      duration: DUR.crossfade,
      easing: EASE.enter,
    });
    return () => cancelAnimation(fill);
  }, [pct, reduced, fill]);
  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: fill.value }],
  }));

  // The frontier heartbeat — the only repeating animation on this screen, and
  // therefore the one that has to be gated properly.
  //
  // Both gates, not one. useImportJob deliberately keeps polling while this
  // screen is parked (the poll is the worker), and the BackHandler above
  // actively invites switching away mid-import — so a loop gated only on mount
  // would run for the entire import, invisibly. That is the reports/10 class:
  // ~40 MB/min of native heap with the screen off. The WORK continues while
  // parked; the ANIMATION does not.
  const appActive = useAppActive();
  const focused = useNavFocused();
  const pulse = useSharedValue(0.6);
  const beating = !reduced && appActive && focused && !stalled;
  useEffect(() => {
    if (!beating) {
      cancelAnimation(pulse);
      pulse.value = 0.6;
      return undefined;
    }
    pulse.value = withRepeat(
      withTiming(1, { duration: DUR.breathe / 2, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => cancelAnimation(pulse);
  }, [beating, pulse]);

  const at = frontierIndex(items);
  const start = Math.max(0, Math.min(at - WINDOW_BEHIND, items.length - WINDOW_ROWS));
  const window = items.slice(start, start + WINDOW_ROWS);

  const reveal = revealItem(items);

  return (
    <>
      {/* No abstract scene here any more — field verdict: "too subtle,
          concept isn't working". The arriving songs themselves are the
          progress display: the reveal card celebrates the newest match, the
          windowed rows below it name the one being worked and what happened
          to the rest, and the pill (once the playlist exists) hands the user
          into it while the rest keeps streaming. */}
      <View style={[styles.track, { backgroundColor: t.line }]}>
        <Animated.View
          style={[styles.fill, { backgroundColor: t.accent }, fillStyle]}
        />
      </View>

      <View style={styles.stage}>
        <Text style={[styles.progressLine, { color: t.ink }]}>{line}</Text>
        <Text
          accessibilityLabel={`${COPY.progress.elapsedLabel} ${fmtTime(elapsed)}`}
          style={[type.time, { color: t.inkFaint }]}
        >
          {fmtTime(elapsed)}
        </Text>
      </View>

      <Text style={[styles.word, { color: t.inkFaint }]}>{word}</Text>

      {/* The handoff. Rendered from screen-owned state: the pill invites, and
          for a user who just watches, the sweep fills as a 3s timer walks
          them in. Any touch anywhere on this scroll cancels the timer — the
          pill stays for a manual tap. */}
      {pill?.show && (
        <View style={styles.pillWrap}>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel={COPY.progress.openNow}
            onPress={pill.onPress}
            style={[styles.openPill, { borderColor: t.accent }]}
          >
            <Animated.View
              pointerEvents="none"
              style={[styles.pillSweep, { backgroundColor: t.accentSoft }, pill.sweepStyle]}
            />
            <Text style={[styles.openPillText, { color: t.accent }]}>
              {COPY.progress.openNow}
            </Text>
          </PressScale>
          <Text style={[label(8.5), styles.pillHint, { color: t.inkFaint }]}>
            {pill.autoOpening ? COPY.progress.autoOpen : COPY.progress.openNowHint}
          </Text>
        </View>
      )}

      {reveal && <RevealCard item={reveal} />}

      {window.length > 0 && (
        <View style={styles.rows}>
          {window.map((item, i) => (
            <ImportRow
              key={item.id ?? start + i}
              item={item}
              isFrontier={start + i === at}
              waiting={start + i > at}
              pulse={pulse}
            />
          ))}
        </View>
      )}

      {/* True, and worth saying: the stack keeps this screen mounted when the
          user opens another, and the daily cron finishes whatever is left.
          Without this line people sit and watch. */}
      <Text style={[styles.hint, { color: t.inkSoft }]}>
        {COPY.progress.safeToLeave}
      </Text>
      {pollError && !stalled && (
        <Text style={[label(8.5), { color: t.inkFaint }]}>
          {COPY.progress.building}
        </Text>
      )}
      {stalled && (
        <>
          <Note title={COPY.progress.stalled} body={COPY.progress.safeToLeave} />
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={COPY.progress.resume}
              onPress={onResume}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Text style={[styles.goAction, { color: t.accent }]}>
                {COPY.progress.resume}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </>
  );
}

function FailedState({ job, onRetry, onClose }) {
  const { t } = useTheme();
  const err = copyForCode(job.error, null);
  return (
    <>
      <Note title={err.title} body={err.body} warn />
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={COPY.done.later}
          onPress={onClose}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Text style={[styles.quietAction, { color: t.inkSoft }]}>
            {COPY.done.later}
          </Text>
        </Pressable>
        {/* Only where retrying can actually change the answer. A retry button on
            an exhausted daily quota is a lie the user pays for by pressing it. */}
        {isRetryable(job.error) && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={COPY.confirm.action}
            onPress={onRetry}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Text style={[styles.goAction, { color: t.accent }]}>
              {COPY.confirm.action}
            </Text>
          </Pressable>
        )}
      </View>
    </>
  );
}

function DoneState({ job, onReview, onOpen, onLater }) {
  const { t } = useTheme();
  const { auto = 0, review = 0, unmatched = 0 } = job.counts ?? {};
  const nothing = auto === 0 && review === 0;
  // These are in your playlist now: up to five of the matched covers, fanned.
  // Only rows that carry their winner have art (cache hits store null), so the
  // fan simply shows fewer — or none, and then it doesn't render.
  const fanArts = (job.items ?? [])
    .filter(i => (i.tier === 'auto' || i.state === 'accepted') && i.candidates?.[0]?.imageUrl)
    .slice(0, 5);
  return (
    <>
      {fanArts.length > 0 && (
        <View style={styles.fan}>
          {fanArts.map((i, idx) => (
            <StaggerIn key={i.id} delay={idx * 90}>
              <Image
                source={{ uri: artUrl(i.candidates[0], 150) }}
                style={[
                  styles.fanArt,
                  idx > 0 && styles.fanArtOverlap,
                  {
                    transform: [{ rotate: `${(idx - (fanArts.length - 1) / 2) * 8}deg` }],
                    zIndex: idx,
                  },
                ]}
              />
            </StaggerIn>
          ))}
        </View>
      )}

      <View style={[styles.note, { backgroundColor: t.surface }]}>
        {nothing ? (
          <Text style={[styles.noteBody, { color: t.ink }]}>
            {COPY.done.nothingMatched}
          </Text>
        ) : (
          <>
            {/* The number rolls up (CountUp); the canonical sentence stays the
                copy pack's, worn as the accessibility label so a screen reader
                hears it whole rather than a numeral and a fragment. */}
            <Text
              accessibilityLabel={COPY.done.ready(auto)}
              style={[styles.summaryHead, { color: t.ink }]}
            >
              <CountUp to={auto} />
              {COPY.done.ready(auto).replace(/^\d+/, '')}
            </Text>
            {review > 0 && (
              <StaggerIn delay={140}>
                <Text style={[styles.noteBody, { color: t.inkSoft }]}>
                  {COPY.done.review(review)}
                </Text>
              </StaggerIn>
            )}
            {unmatched > 0 && (
              <StaggerIn delay={280}>
                <Text style={[styles.noteBody, { color: t.inkFaint }]}>
                  {COPY.done.missing(unmatched)}
                </Text>
              </StaggerIn>
            )}
            {review === 0 && unmatched === 0 && (
              <StaggerIn delay={140}>
                <Text style={[styles.noteBody, { color: t.inkSoft }]}>
                  {COPY.done.allAuto}
                </Text>
              </StaggerIn>
            )}
          </>
        )}
      </View>

      {review > 0 && (
        <Text style={[styles.hint, { color: t.inkSoft }]}>
          {COPY.done.reassurance}
        </Text>
      )}

      <View style={styles.actions}>
        {nothing ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={COPY.done.later}
            onPress={onLater}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Text style={[styles.goAction, { color: t.accent }]}>
              {COPY.done.later}
            </Text>
          </Pressable>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={COPY.done.open}
              onPress={onOpen}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Text style={[styles.quietAction, { color: t.inkSoft }]}>
                {COPY.done.open}
              </Text>
            </Pressable>
            {review > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={COPY.done.reviewAction}
                onPress={onReview}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <Text style={[styles.goAction, { color: t.accent }]}>
                  {COPY.done.reviewAction}
                </Text>
              </Pressable>
            )}
          </>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 10, gap: 9 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hero: { marginTop: 2, marginBottom: 10 },
  pressed: { opacity: 0.6 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.regular,
    fontSize: 15,
  },
  hint: { fontFamily: fonts.regular, fontSize: 13 },
  note: { borderRadius: 12, padding: 14, gap: 5 },
  noteWarn: { borderLeftWidth: 2 },
  noteTitle: { fontFamily: fonts.semibold, fontSize: 15 },
  noteBody: { fontFamily: fonts.regular, fontSize: 13.5 },
  summaryHead: { fontFamily: fonts.semibold, fontSize: 19 },
  ghosts: { gap: 9, paddingTop: 10 },
  ghost: { height: 42, borderRadius: 8 },
  track: { height: 3, borderRadius: 999, overflow: 'hidden', marginTop: 6 },
  // Full width, scaled from the left — scaleX runs on the UI thread where a
  // percentage width cannot.
  fill: { height: 3, borderRadius: 999, width: '100%', transformOrigin: 'left' },
  stage: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  progressLine: { flex: 1, fontFamily: fonts.medium, fontSize: 15 },
  // Prose, not a MonoLabel: these strings run to 36 characters and the
  // uppercase label() register would make them shout over the line above.
  word: { fontFamily: fonts.regular, fontSize: 12.5, marginTop: -3 },
  rows: { gap: 2, paddingTop: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 7,
  },
  phaseBody: { gap: 9 },
  // Wide enough for the 22px art disc; dots simply centre in the same space.
  gutter: { width: 24, alignItems: 'center', justifyContent: 'center' },
  rowArt: { width: 22, height: 22, borderRadius: 999 },
  reveal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    padding: 12,
  },
  pillWrap: { alignItems: 'center', gap: 6, marginVertical: 4 },
  openPill: {
    borderWidth: 1.5,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 26,
    overflow: 'hidden',
  },
  pillSweep: {
    ...StyleSheet.absoluteFillObject,
    transformOrigin: 'left',
  },
  openPillText: { fontFamily: fonts.semibold, fontSize: 15 },
  pillHint: { textAlign: 'center' },
  revealArt: { width: 48, height: 48, borderRadius: 8 },
  revealRing: {
    position: 'absolute',
    left: -6,
    top: -6,
    width: 60,
    height: 60,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  revealWash: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 12,
  },
  revealArtFallback: { alignItems: 'center', justifyContent: 'center' },
  revealLetter: { fontFamily: fonts.semibold, fontSize: 19 },
  revealMeta: { flex: 1, minWidth: 0, gap: 1 },
  revealTitle: { fontFamily: fonts.medium, fontSize: 15 },
  revealArtist: { fontFamily: fonts.regular, fontSize: 12.5 },
  revealWas: { fontFamily: fonts.regular, fontSize: 11, marginTop: 3 },
  fan: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    paddingVertical: 10,
  },
  fanArt: { width: 64, height: 64, borderRadius: 10 },
  fanArtOverlap: { marginLeft: -26 },
  dotDone: { width: 3, height: 3, borderRadius: 999 },
  dotNow: { width: 5, height: 5, borderRadius: 999 },
  // Songs the drain has not reached yet, dimmed so the eye lands on the one
  // being worked rather than on the queue behind it.
  rowWaiting: { opacity: 0.45 },
  rowTitle: { flex: 1, minWidth: 0, fontFamily: fonts.regular, fontSize: 13.5 },
  rowStatus: { flexShrink: 0 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 22,
    paddingVertical: 10,
  },
  quietAction: { fontFamily: fonts.medium, fontSize: 14.5 },
  goAction: { fontFamily: fonts.medium, fontSize: 14.5 },
});
