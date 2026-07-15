import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { usePlaybackProgress } from '../hooks/usePlaybackProgress';
import { getLyrics } from '../api/lyrics';
import { activeIndexFor, gapWindows } from '../lib/lyricsSync';
import { cleanLyric, cleanTitle } from '../utils/title';
import { HeartButton } from '../components/player/HeartButton';
import { Icon } from '../components/Icon';
import { Glass } from '../components/ui/Glass';
import { GradientBg } from '../components/ui/GradientBg';
import { fonts } from '../theme/tokens';
import { EASE } from '../theme/motion';

// Web LyricsScreen.css: panel/backdrop enter-exit timings and the cinematic
// dissolve (800ms ease). The toggle thumb slides on the same curve the panel
// enters with.
const PANEL_IN_MS = 260;
const PANEL_OUT_MS = 220;
const CINEMA_MS = 800;
const LINE_MS = 380;
const IDLE_MS = 5000; // no interaction → cinematic
const POLL_MS = 25000; // 'pending' (server still generating) re-poll
const PANEL_RADIUS = 24;
const SLIDE = Easing.bezier(0.22, 1, 0.36, 1);

const artUrl = track =>
  track?.imageUrl ? track.imageUrl.replace(/\d+x\d+/, '500x500') : null;

// Equalizer-style "music is playing" mark — five vertical bars bouncing on
// asymmetric staggered timings (web aura-lyrics-gap-bar: 1000ms, scaleY
// 0.3→1, opacity 0.65→1). Reads as a live audio meter, not a spinner.
const BARS = [
  { h: 0.55, d: 0 },
  { h: 1, d: 130 },
  { h: 0.8, d: 290 },
  { h: 1, d: 410 },
  { h: 0.65, d: 560 },
];

function GapBar({ h, d, accent, reduced }) {
  const v = useSharedValue(0);
  useEffect(() => {
    if (reduced) {
      v.value = 0.57; // scaleY ≈ 0.7 static
      return undefined;
    }
    v.value = withDelay(
      d,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 500, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: 500, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(v);
  }, [d, reduced, v]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.65 + v.value * 0.35,
    transform: [{ scaleY: 0.3 + v.value * 0.7 }],
  }));
  return (
    <Animated.View
      style={[
        styles.gapBar,
        { height: 32 * h, backgroundColor: accent },
        style,
      ]}
    />
  );
}

function GapMark({ accent, reduced }) {
  return (
    <View style={styles.gapMark}>
      {BARS.map((b, i) => (
        <GapBar key={i} h={b.h} d={b.d} accent={accent} reduced={reduced} />
      ))}
    </View>
  );
}

// One lyric line. The 380ms rise/settle is the web's transition-all; font size
// and color switch with the state (RN can't animate fontSize cheaply, and the
// centering scroll masks the jump). Cinematic depth-of-field: the web blurs
// past/upcoming text — RN can't blur text, so opacity alone carries the depth.
// Handlers arrive stable and take (line, realIdx) so the memo actually holds
// while the 4Hz position ticker re-renders the parent.
const LyricLine = memo(function LyricLine({
  line,
  realIdx,
  text,
  state, // 'active' | 'past' | 'upcoming'
  cinematic,
  reduced,
  ink,
  inkSoft,
  inkFaint,
  onPressLine,
  onLayoutLine,
}) {
  const ty = useSharedValue(state === 'past' ? -2 : state === 'active' ? 0 : 6);
  const op = useSharedValue(1);

  useEffect(() => {
    const targetY = state === 'active' ? 0 : state === 'past' ? -2 : 6;
    const targetOp = cinematic
      ? state === 'active'
        ? 1
        : state === 'past'
          ? 0.3
          : 0.45
      : state === 'active'
        ? 1
        : state === 'past'
          ? 0.6
          : 0.85;
    if (reduced) {
      ty.value = targetY;
      op.value = targetOp;
      return;
    }
    const cfg = { duration: LINE_MS, easing: Easing.inOut(Easing.ease) };
    ty.value = withTiming(targetY, cfg);
    op.value = withTiming(targetOp, cfg);
  }, [state, cinematic, reduced, ty, op]);

  const motion = useAnimatedStyle(() => ({
    opacity: op.value,
    transform: [{ translateY: ty.value }],
  }));

  const active = state === 'active';
  const color = cinematic
    ? active
      ? '#ffffff'
      : state === 'past'
        ? 'rgba(255,255,255,0.7)'
        : 'rgba(255,255,255,0.8)'
    : active
      ? ink
      : state === 'past'
        ? inkFaint
        : inkSoft;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      onPress={() => onPressLine(line)}
      onLayout={e => onLayoutLine(realIdx, e.nativeEvent.layout.y)}
    >
      <Animated.Text
        style={[
          styles.line,
          active ? styles.lineActive : styles.lineRest,
          { color },
          cinematic && active && styles.lineCinemaActive,
          motion,
        ]}
      >
        {text}
      </Animated.Text>
    </Pressable>
  );
});

function SyncedView({
  lines,
  view,
  seconds,
  durationSec,
  playing,
  cinematic,
  reduced,
  accent,
  ink,
  inkSoft,
  inkFaint,
  onSeekLine,
  onWakeScroll,
}) {
  const activeIdx = useMemo(
    () => activeIndexFor(lines, seconds),
    [lines, seconds],
  );
  const { inIntroGap, inBetweenGap, inOutroGap } = gapWindows(
    lines,
    seconds,
    durationSec,
    activeIdx,
  );

  const scrollRef = useRef(null);
  const viewHRef = useRef(0);
  const offsetsRef = useRef({});
  const activeIdxRef = useRef(activeIdx);
  activeIdxRef.current = activeIdx;
  useEffect(() => {
    offsetsRef.current = {};
  }, [lines]);

  // Keep the active line centered (the web's scrollIntoView block:'center').
  const centerOn = useCallback(
    idx => {
      const y = offsetsRef.current[idx];
      if (y == null || !scrollRef.current) {
        return;
      }
      scrollRef.current.scrollTo({
        y: Math.max(0, y - viewHRef.current / 2 + 24),
        animated: !reduced,
      });
    },
    [reduced],
  );
  useEffect(() => {
    centerOn(activeIdx);
  }, [activeIdx, centerOn]);

  // Offsets land after the first render (and shift when a gap mark mounts or
  // unmounts above the active line) — re-center off the measurement itself,
  // so the first open and every layout shift land on the real position.
  const onLayoutLine = useCallback(
    (realIdx, y) => {
      const prev = offsetsRef.current[realIdx];
      offsetsRef.current[realIdx] = y;
      if (realIdx === activeIdxRef.current && prev !== y) {
        centerOn(realIdx);
      }
    },
    [centerOn],
  );

  const lineFor = l => cleanLyric(view === 'en' && l.line_en ? l.line_en : l.line);

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.fill}
      contentContainerStyle={styles.lyricsBody}
      onLayout={e => {
        viewHRef.current = e.nativeEvent.layout.height;
      }}
      onScrollBeginDrag={onWakeScroll}
      showsVerticalScrollIndicator={false}
    >
      {inIntroGap && playing && <GapMark accent={accent} reduced={reduced} />}
      {lines.map((l, realIdx) => {
        if (!l.line) {
          return null;
        }
        // During an instrumental break the previously-active line is no
        // longer being sung — drop its active treatment so the screen reads
        // as "between lyrics" instead of "this line is still current".
        const isActive = realIdx === activeIdx && !inBetweenGap && !inOutroGap;
        const isPast =
          realIdx < activeIdx ||
          (realIdx === activeIdx && (inBetweenGap || inOutroGap));
        const showMarkAfter = inBetweenGap && playing && realIdx === activeIdx;
        return (
          <React.Fragment key={realIdx}>
            <LyricLine
              line={l}
              realIdx={realIdx}
              text={lineFor(l)}
              state={isActive ? 'active' : isPast ? 'past' : 'upcoming'}
              cinematic={cinematic}
              reduced={reduced}
              ink={ink}
              inkSoft={inkSoft}
              inkFaint={inkFaint}
              onPressLine={onSeekLine}
              onLayoutLine={onLayoutLine}
            />
            {showMarkAfter && <GapMark accent={accent} reduced={reduced} />}
          </React.Fragment>
        );
      })}
      {inOutroGap && playing && <GapMark accent={accent} reduced={reduced} />}
    </ScrollView>
  );
}

// Plain (untimed) lyrics — no active highlight, tap-to-seek, or gap marks:
// just a readable column that still honours the english ⇄ original toggle.
function PlainView({ lines, view, inkSoft, inkFaint, onWakeScroll }) {
  const lineFor = l => cleanLyric(view === 'en' && l.line_en ? l.line_en : l.line);
  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.plainBody}
      onScrollBeginDrag={onWakeScroll}
      showsVerticalScrollIndicator={false}
    >
      {lines
        .filter(l => l.line)
        .map((l, i) => (
          <Text key={i} style={[styles.plainLine, { color: inkSoft }]}>
            {lineFor(l)}
          </Text>
        ))}
      <Text style={[styles.plainCaption, { color: inkFaint }]}>
        these lyrics aren't synced to the music.
      </Text>
    </ScrollView>
  );
}

// English ⇄ original segmented pill with a sliding accent thumb.
function ViewToggle({ view, language, onChange, t }) {
  const [w, setW] = useState(0);
  const x = useSharedValue(view === 'orig' ? 1 : 0);
  useEffect(() => {
    x.value = withTiming(view === 'orig' ? 1 : 0, {
      duration: 260,
      easing: SLIDE,
    });
  }, [view, x]);
  const travel = Math.max(0, w / 2 - 2);
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value * travel }],
  }));
  return (
    <View
      style={styles.toggle}
      onLayout={e => setW(e.nativeEvent.layout.width)}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.toggleThumb,
          { width: travel, backgroundColor: t.accent },
          thumbStyle,
        ]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="english"
        onPress={() => onChange('en')}
        style={styles.toggleBtn}
      >
        <Text
          style={[
            styles.toggleText,
            { color: view === 'en' ? t.bg : t.inkSoft },
          ]}
        >
          english
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={language}
        onPress={() => onChange('orig')}
        style={styles.toggleBtn}
      >
        <Text
          style={[
            styles.toggleText,
            { color: view === 'orig' ? t.bg : t.inkSoft },
          ]}
        >
          {language}
        </Text>
      </Pressable>
    </View>
  );
}

// Full-screen lyrics overlay — an inset glass panel over a dimmed backdrop,
// opened from the player. Rides between the player (30) and the queue (40)
// in the overlay ladder. After 5s of stillness it goes cinematic: the glass
// dissolves, the cover art sharpens into a slow Ken Burns drift, and the
// lines float over it like a projection. Any touch brings the chrome back.
export function LyricsOverlay() {
  const { t, name } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const player = usePlayer();
  const { position, duration } = usePlaybackProgress();
  const reduced = useReducedMotion();

  const track = player.current;
  const open = player.ui?.lyricsOpen ?? false;

  const [vis, setVis] = useState('closed'); // 'closed' | 'open' | 'closing'
  const [hit, setHit] = useState({ trackId: null, data: null, error: null });
  const [view, setView] = useState('en'); // 'en' = romanized, 'orig' = original
  const [cinematic, setCinematic] = useState(false);

  const enter = useSharedValue(0);
  const cin = useSharedValue(0);
  const kb = useSharedValue(0);

  const endClose = useCallback(() => setVis('closed'), []);

  useEffect(() => {
    if (open && vis === 'closed') {
      if (reduced) {
        enter.value = 1;
      } else {
        enter.value = 0;
        enter.value = withTiming(1, { duration: PANEL_IN_MS, easing: SLIDE });
      }
      // Every open starts romanized, like the web's fresh mount.
      setView('en');
      setVis('open');
    }
    if (!open && vis === 'open') {
      setVis('closed');
    }
  }, [open, vis, reduced, enter]);

  const close = useCallback(() => {
    if (vis === 'closing') {
      return;
    }
    setVis('closing');
    player.ui?.closeLyrics?.();
    if (reduced) {
      endClose();
      return;
    }
    enter.value = withTiming(
      0,
      { duration: PANEL_OUT_MS, easing: EASE.exit },
      done => {
        if (done) {
          runOnJS(endClose)();
        }
      },
    );
  }, [vis, reduced, endClose, player.ui, enter]);

  // Hardware back closes the lyrics, not the player under them (LIFO —
  // registered while open, after the player's own handler).
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

  // Fetch on open + whenever the playing track changes underneath the open
  // overlay (auto-advance keeps the lyrics following the music).
  const trackId = track?.id;
  useEffect(() => {
    if (!open || !trackId) {
      return undefined;
    }
    const ctl = new AbortController();
    getLyrics(trackId, { signal: ctl.signal })
      .then(data => setHit({ trackId, data, error: null }))
      .catch(err => {
        if (err.name === 'AbortError') {
          return;
        }
        setHit({ trackId, data: null, error: err.message });
      });
    return () => ctl.abort();
  }, [open, trackId]);

  const status =
    hit.trackId === trackId
      ? hit.error
        ? 'error'
        : hit.data
          ? 'ok'
          : 'loading'
      : 'loading';

  // While the server is generating synced lyrics, poll so the finished
  // lyrics replace the "syncing…" state without reopening the overlay. The
  // abort matters: without it a poll in flight across a track change would
  // land late and clobber the new track's hit (web parity guard).
  const pending = status === 'ok' && !!hit.data?.pending;
  useEffect(() => {
    if (!open || !pending || !trackId) {
      return undefined;
    }
    const ctl = new AbortController();
    const id = setInterval(() => {
      getLyrics(trackId, { signal: ctl.signal })
        .then(data => setHit({ trackId, data, error: null }))
        .catch(() => {}); // transient — keep polling
    }, POLL_MS);
    return () => {
      ctl.abort();
      clearInterval(id);
    };
  }, [open, pending, trackId]);

  // Cinematic idle: 5s without a touch. A tap while cinematic is wake-only —
  // it restores the chrome without seeking to the tapped line (wokeAt guards
  // the press handler that fires right after the wake). Reduced motion never
  // enters cinematic (deliberate divergence from the web: the dissolve would
  // be a one-frame snap), so arm() must respect it too — wake() fires from
  // every touch, including during the closing animation.
  const timerRef = useRef(null);
  const cinRef = useRef(false);
  cinRef.current = cinematic;
  const openRef = useRef(open);
  openRef.current = open;
  const wokeAt = useRef(0);
  const arm = useCallback(() => {
    clearTimeout(timerRef.current);
    if (reduced || !openRef.current) {
      return;
    }
    timerRef.current = setTimeout(() => setCinematic(true), IDLE_MS);
  }, [reduced]);
  const wake = useCallback(() => {
    if (cinRef.current) {
      wokeAt.current = Date.now();
      setCinematic(false);
    }
    arm();
  }, [arm]);

  useEffect(() => {
    if (!open || reduced) {
      setCinematic(false);
      return undefined;
    }
    arm();
    return () => clearTimeout(timerRef.current);
  }, [open, reduced, arm]);

  useEffect(() => {
    cin.value = withTiming(cinematic ? 1 : 0, {
      duration: reduced ? 0 : CINEMA_MS,
      easing: Easing.inOut(Easing.ease),
    });
  }, [cinematic, reduced, cin]);

  // Ken Burns — slow zoom + subtle drift while cinematic, seamlessly
  // reversing (the web's 30s alternate keyframes, collapsed to two poses).
  useEffect(() => {
    if (cinematic && !reduced) {
      kb.value = withRepeat(
        withTiming(1, { duration: 15000, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      return () => cancelAnimation(kb);
    }
    kb.value = withTiming(0, { duration: 600 });
    return undefined;
  }, [cinematic, reduced, kb]);

  const isMidnight = name === 'midnight';
  const tintIdle = isMidnight ? 0.4 : 0.28;
  const tintCinema = isMidnight ? 0.92 : 0.85;
  const panelW = winW - 28;

  const panelStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      { translateY: (1 - enter.value) * 24 },
      { scale: 0.96 + enter.value * 0.04 },
    ],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: enter.value * 0.32,
  }));
  const glassStyle = useAnimatedStyle(() => ({
    opacity: 1 - cin.value,
  }));
  const tintSoftStyle = useAnimatedStyle(() => ({
    opacity: tintIdle * (1 - cin.value),
  }));
  const tintSharpStyle = useAnimatedStyle(() => ({
    opacity: tintCinema * cin.value,
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: cin.value }));
  const chromeStyle = useAnimatedStyle(() => ({
    opacity: 1 - cin.value,
  }));
  const cinemaInStyle = useAnimatedStyle(() => ({ opacity: cin.value }));
  const kenBurns = useAnimatedStyle(() => ({
    transform: [
      { scale: 1.05 + kb.value * 0.1 },
      { translateX: kb.value * -0.02 * panelW },
      { translateY: kb.value * 0.01 * panelW },
    ],
  }));

  // Stable so LyricLine's memo holds at the 4Hz position tick. Wake-only
  // taps: the touch that broke cinematic (and its own press, ~a beat later)
  // must not seek — 400ms covers the press without eating the next real tap.
  const seekTo = player.seekTo;
  const onSeekLine = useCallback(
    l => {
      if (cinRef.current || Date.now() - wokeAt.current < 400) {
        return;
      }
      seekTo(l.t);
    },
    [seekTo],
  );

  if ((!open && vis !== 'closing') || !track) {
    return null;
  }

  const cover = artUrl(track);
  const data = status === 'ok' ? hit.data : null;
  const hasEnglish = !!data?.has_english;
  // If the server didn't produce a romanization (already-Latin track), keep
  // the toggle hidden and pin the view to the original script.
  const effectiveView = hasEnglish ? view : 'orig';
  const seconds = position ?? 0;
  const progress = duration > 0 ? Math.min(1, seconds / duration) : 0;
  const ended = duration > 0 && progress >= 0.995 && !player.isPlaying;

  return (
    <View style={styles.root} onTouchStart={wake}>
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="close lyrics"
          onPress={close}
          style={styles.fill}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.panel,
          {
            top: insets.top + 16,
            bottom: insets.bottom + 16,
          },
          panelStyle,
        ]}
      >
        {/* Glass chrome — dissolves away in cinematic mode. */}
        <Animated.View style={[StyleSheet.absoluteFill, glassStyle]}>
          <Glass radius={PANEL_RADIUS} style={styles.fill} />
        </Animated.View>

        {/* Cover-art tint: blurred ambient normally, sharp + drifting in
            cinematic (two static blurs crossfaded — opacity-only work). */}
        {cover && (
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.clip, kenBurns]}
          >
            <Animated.Image
              source={{ uri: cover }}
              blurRadius={48}
              style={[StyleSheet.absoluteFill, tintSoftStyle]}
              resizeMode="cover"
            />
            <Animated.Image
              source={{ uri: cover }}
              blurRadius={4}
              style={[StyleSheet.absoluteFill, tintSharpStyle]}
              resizeMode="cover"
            />
          </Animated.View>
        )}

        {/* Dark scrim keeps cinematic text readable over bright art. */}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.clip, scrimStyle]}
        >
          <GradientBg
            angle={180}
            stops={[
              { offset: 0, color: '#000', opacity: 0.55 },
              { offset: 0.35, color: '#000', opacity: 0.2 },
              { offset: 0.65, color: '#000', opacity: 0.12 },
              { offset: 1, color: '#000', opacity: 0.5 },
            ]}
          />
        </Animated.View>

        {/* Cinematic progress hairline along the top edge. Stays mounted so
            its 800ms dissolve plays both ways (cin drives the opacity). */}
        <Animated.View
          pointerEvents="none"
          style={[styles.progressArc, cinemaInStyle]}
        >
          <View
            style={[
              styles.progressFill,
              { width: `${progress * 100}%`, backgroundColor: t.accent },
            ]}
          />
          <View style={[styles.progressDot, styles.progressDotStart]} />
          <View
            style={[
              styles.progressDot,
              styles.progressDotEnd,
              ended && { backgroundColor: t.accent },
            ]}
          />
        </Animated.View>

        {/* Handwritten epigraph — the song title as a movie title card. */}
        {!!track.title && (
          <Animated.View
            pointerEvents="none"
            style={[styles.epigraph, cinemaInStyle]}
          >
            <Text style={styles.epigraphTitle}>{cleanTitle(track.title)}</Text>
            <Text style={styles.epigraphCounter}>
              {ended ? 'song ended' : track.artist || 'unknown artist'}
            </Text>
          </Animated.View>
        )}

        <View style={styles.stage}>
          <Animated.View
            style={chromeStyle}
            pointerEvents={cinematic ? 'none' : 'auto'}
          >
            <View style={styles.header}>
              <View style={styles.headerRow}>
                <Text
                  numberOfLines={1}
                  style={[styles.headerTitle, { color: t.ink }]}
                >
                  {cleanTitle(track.title)}
                </Text>
                <View
                  style={[
                    styles.cluster,
                    // Web: ink at ~6% over the panel; t.line (ink@10%) is the
                    // nearest token and reads identically over the art tint.
                    isMidnight ? styles.clusterMidnight : null,
                    !isMidnight && { backgroundColor: t.line },
                    { borderColor: t.line },
                  ]}
                >
                  <HeartButton
                    trackId={track.id}
                    size={20}
                    color={t.ink}
                    accent={t.accent}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="close lyrics"
                    onPress={close}
                    hitSlop={8}
                    style={styles.closeBtn}
                  >
                    <Icon name="close" size={14} color={t.inkSoft} />
                  </Pressable>
                </View>
              </View>
              <View style={styles.headerRow}>
                <Text
                  numberOfLines={1}
                  style={[styles.headerMeta, { color: t.inkFaint }]}
                >
                  {track.artist || 'unknown artist'}
                </Text>
                {hasEnglish && (
                  <ViewToggle
                    view={effectiveView}
                    language={track.language || 'original'}
                    onChange={setView}
                    t={t}
                  />
                )}
              </View>
            </View>
          </Animated.View>

          {status === 'loading' && (
            <View style={styles.centerBody}>
              <ActivityIndicator color={t.accent} />
            </View>
          )}

          {status === 'error' && (
            <View style={styles.messageBody}>
              <Text style={[styles.messageText, { color: t.inkSoft }]}>
                couldn't fetch lyrics — {hit.error}
              </Text>
            </View>
          )}

          {status === 'ok' && data.pending && (
            <View style={styles.centerBody}>
              <GapMark accent={t.accent} reduced={reduced} />
              <Text
                style={[
                  styles.messageText,
                  styles.centerText,
                  { color: t.inkSoft },
                ]}
              >
                syncing the lyrics…{'\n'}lining the words up to the music —
                check back in a moment.
              </Text>
            </View>
          )}

          {status === 'ok' && !data.available && !data.pending && (
            <View style={styles.centerBody}>
              <Text
                style={[
                  styles.unavailable,
                  styles.centerText,
                  { color: t.inkSoft },
                ]}
              >
                lyrics aren't available{'\n'}for this track.
              </Text>
            </View>
          )}

          {status === 'ok' && data.available && data.synced && (
            <SyncedView
              lines={data.lines}
              view={effectiveView}
              seconds={seconds}
              durationSec={duration}
              playing={player.isPlaying}
              cinematic={cinematic}
              reduced={reduced}
              accent={t.accent}
              ink={t.ink}
              inkSoft={t.inkSoft}
              inkFaint={t.inkFaint}
              onSeekLine={onSeekLine}
              onWakeScroll={wake}
            />
          )}

          {status === 'ok' && data.available && !data.synced && !data.pending && (
            <PlainView
              lines={data.lines}
              view={effectiveView}
              inkSoft={t.inkSoft}
              inkFaint={t.inkFaint}
              onWakeScroll={wake}
            />
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    // zIndex only — elevation buries sibling overlays on this device.
    // Ladder: player 30, lyrics 36, queue 40, action sheets 50.
    zIndex: 36,
  },
  fill: { flex: 1 },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  panel: {
    position: 'absolute',
    left: 14,
    right: 14,
    borderRadius: PANEL_RADIUS,
    overflow: 'hidden',
  },
  clip: { borderRadius: PANEL_RADIUS, overflow: 'hidden' },
  stage: { flex: 1 },
  header: {
    paddingTop: 14,
    paddingHorizontal: 22,
    paddingBottom: 16,
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerTitle: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 26,
    lineHeight: 31,
    letterSpacing: -0.39,
  },
  headerMeta: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
  },
  cluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    paddingLeft: 10,
    paddingRight: 8,
    borderRadius: 18,
    borderWidth: 1,
  },
  clusterMidnight: { backgroundColor: 'rgba(255,255,255,0.04)' },
  closeBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggle: {
    flexDirection: 'row',
    padding: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  toggleThumb: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: 2,
    borderRadius: 999,
  },
  toggleBtn: {
    minWidth: 48,
    paddingVertical: 3,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  toggleText: {
    fontFamily: fonts.medium,
    fontSize: 10,
    lineHeight: 14,
  },
  lyricsBody: {
    paddingHorizontal: 28,
    paddingTop: 4,
    paddingBottom: 120,
    gap: 22,
  },
  line: {
    fontFamily: 'Fraunces-Regular',
    textAlign: 'left',
  },
  lineActive: {
    fontSize: 30,
    lineHeight: 35,
    letterSpacing: -0.3,
  },
  lineRest: {
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: -0.22,
  },
  lineCinemaActive: {
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 16,
  },
  plainBody: {
    paddingHorizontal: 28,
    paddingTop: 4,
    paddingBottom: 40,
    gap: 18,
  },
  plainLine: {
    fontFamily: 'Fraunces-Regular',
    fontSize: 22,
    lineHeight: 29,
    letterSpacing: -0.22,
  },
  plainCaption: {
    fontFamily: fonts.regular,
    fontSize: 12,
    marginTop: 14,
  },
  gapMark: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 32,
    marginLeft: 2,
  },
  gapBar: {
    width: 3,
    borderRadius: 2,
    transformOrigin: 'bottom',
  },
  centerBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    padding: 28,
  },
  messageBody: {
    flex: 1,
    padding: 28,
  },
  messageText: {
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 22,
  },
  centerText: { textAlign: 'center' },
  unavailable: {
    fontFamily: fonts.regular,
    fontSize: 18,
    lineHeight: 25,
  },
  progressArc: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.10)',
    zIndex: 3,
  },
  progressFill: { height: 2 },
  progressDot: {
    position: 'absolute',
    top: -1.5,
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  progressDotStart: {
    left: 26,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  progressDotEnd: {
    right: 26,
    backgroundColor: 'rgba(255,255,255,0.30)',
  },
  epigraph: {
    position: 'absolute',
    top: 28,
    left: 0,
    right: 0,
    zIndex: 2,
    paddingHorizontal: 22,
    alignItems: 'center',
  },
  epigraphTitle: {
    fontFamily: 'DancingScript-Bold',
    fontSize: 44,
    lineHeight: 50,
    letterSpacing: 0.22,
    color: 'rgba(255,255,255,0.96)',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 24,
  },
  epigraphCounter: {
    marginTop: 10,
    fontFamily: fonts.medium,
    fontSize: 11,
    letterSpacing: 0.66,
    color: 'rgba(255,255,255,0.65)',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
});
