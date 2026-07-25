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
import { requestStems } from '../api/stems';
import { showToast } from '../lib/toast';
import {
  activeIndexFor,
  COUNTDOWN_SEC,
  gapWindows,
  lineSweep,
  nextLineIn,
} from '../lib/lyricsSync';
import { HINT_KARAOKE, HINT_STAGE_TAP, markHintDone } from '../lib/hints';
import { useHintActive } from '../hooks/useHintActive';
import { cleanLyric, cleanTitle } from '../utils/title';
import { shareLyric } from '../lib/share';
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
const STEMS_POLL_MS = 20000; // "music only" preparation re-poll
const PANEL_RADIUS = 24;
const SLIDE = Easing.bezier(0.22, 1, 0.36, 1);

const artUrl = (track, res = 500) =>
  track?.imageUrl ? track.imageUrl.replace(/\d+x\d+/, `${res}x${res}`) : null;

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
  onLongPressLine,
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
      onLongPress={() => onLongPressLine?.(line)}
      delayLongPress={350}
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
  onShareLine,
  onWakeScroll,
}) {
  // Stable per view-toggle, so the LyricLine memo keeps holding under the
  // 4Hz position ticker.
  const onLongPressLine = useCallback(
    l =>
      onShareLine?.(cleanLyric(view === 'en' && l.line_en ? l.line_en : l.line)),
    [onShareLine, view],
  );
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
              onLongPressLine={onLongPressLine}
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
function PlainView({ lines, view, inkSoft, inkFaint, onShareLine, onWakeScroll }) {
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
          <Pressable
            key={i}
            onLongPress={() => onShareLine?.(lineFor(l))}
            delayLongPress={350}
          >
            <Text style={[styles.plainLine, { color: inkSoft }]}>
              {lineFor(l)}
            </Text>
          </Pressable>
        ))}
      <Text style={[styles.plainCaption, { color: inkFaint }]}>
        these lyrics aren't synced to the music.
      </Text>
    </ScrollView>
  );
}

// The classic karaoke "get ready" cue: three uniform dots that vanish one by
// one as the next line approaches (each stands for a third of the countdown
// window), sitting right above that line shown dimmed in place — "this starts
// in 3, 2, 1". Driven by the position ticker — honest to the actual
// timestamps, no free-running timer to drift or leak.
function CountdownDots({ remain, accent }) {
  const slot = COUNTDOWN_SEC / 3;
  return (
    <View style={styles.countdown}>
      {[0, 1, 2].map(i => (
        <CountdownDot key={i} on={remain > i * slot} accent={accent} />
      ))}
    </View>
  );
}

function CountdownDot({ on, accent }) {
  const v = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    v.value = withTiming(on ? 1 : 0, {
      duration: 280,
      easing: Easing.out(Easing.ease),
    });
  }, [on, v]);
  // A spent dot is GONE — lingering half-faded specks read as a glitch.
  const style = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ scale: 0.3 + v.value * 0.7 }],
  }));
  return (
    <Animated.View
      style={[styles.countdownDot, { backgroundColor: accent }, style]}
    />
  );
}

// A soft repeating swell that points the eye at a control until its hint is
// learned. Decorative wrapper — layout and labels pass through untouched.
function HintPulse({ active, children }) {
  const v = useSharedValue(1);
  useEffect(() => {
    if (active) {
      v.value = withRepeat(
        withSequence(
          withTiming(1.07, {
            duration: 700,
            easing: Easing.inOut(Easing.ease),
          }),
          withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
      );
      return () => cancelAnimation(v);
    }
    v.value = withTiming(1, { duration: 200 });
    return undefined;
  }, [active, v]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: v.value }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

// English ⇄ original segmented pill with a sliding accent thumb.
// Karaoke — the synced lines as a stage: previous and next lines dimmed
// around one big centered current line with a smooth accent fill sweeping it
// as it plays. The sweep is lib/lyricsSync.lineSweep — a per-line
// interpolation, because the source only carries line-level timings (an
// honest line fill, not fake word sync; on a wrapped line every row fills
// together). Instrumental breaks put the gap mark on the stage. No vocal
// removal — karaoke here is the lyric experience; "minus one" DSP over a
// 320 AAC would wreck the sound.
function KaraokeView({
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
  onToggle,
  stageHint,
  musicOnly,
  preparingStems,
  onMusicOnly,
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
  const inGap = inIntroGap || inBetweenGap || inOutroGap;
  const lineFor = l =>
    l ? cleanLyric(view === 'en' && l.line_en ? l.line_en : l.line) : '';

  // Stage slots. During a break the sung line is done — it moves up to the
  // previous slot and the gap mark takes the stage, handing over to the
  // countdown across the final seconds so the singer knows exactly when to
  // come back in. Before the first line (short intro) the opening line waits
  // quietly, unswept. Paused, the stage never sits empty: whatever comes
  // next rests dimly above the paused cue.
  const current = !inGap && activeIdx >= 0 ? lines[activeIdx] : null;
  const prevLine =
    inBetweenGap || inOutroGap
      ? lines[activeIdx]
      : activeIdx > 0
        ? lines[activeIdx - 1]
        : null;
  const waiting = !current && !inGap && activeIdx < 0 ? lines[0] : null;
  const countdown =
    inGap && playing ? nextLineIn(lines, seconds, activeIdx) : null;
  const showMark = inGap && playing && countdown == null;
  const resting =
    !playing && !current
      ? (lines[activeIdx + 1] ?? lines[activeIdx] ?? lines[0] ?? null)
      : null;
  // During the countdown the incoming line already stands on the main stage,
  // so the preview slot looks one further ahead instead of duplicating it.
  const nextUp = countdown != null ? (lines[activeIdx + 1] ?? null) : null;
  const preview = waiting
    ? (lines[1] ?? null)
    : countdown != null
      ? (lines[activeIdx + 2] ?? null)
      : (lines[activeIdx + 1] ?? null);

  // Entering karaoke should feel like stepping onto a stage — one settle-in
  // on mount, not an instant view swap.
  const enterK = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (!reduced) {
      enterK.value = withTiming(1, { duration: 420, easing: SLIDE });
    }
  }, [reduced, enterK]);
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enterK.value,
    transform: [
      { translateY: (1 - enterK.value) * 14 },
      { scale: 0.97 + enterK.value * 0.03 },
    ],
  }));

  // Smooth fill: snap when the line changes, glide between position ticks.
  const sweep = lineSweep(lines, seconds, durationSec, activeIdx);
  const sw = useSharedValue(sweep);
  const lastIdxRef = useRef(activeIdx);
  const [lineW, setLineW] = useState(0);
  useEffect(() => {
    if (lastIdxRef.current !== activeIdx || reduced) {
      lastIdxRef.current = activeIdx;
      sw.value = sweep;
      return;
    }
    sw.value = withTiming(sweep, { duration: 260, easing: Easing.linear });
  }, [sweep, activeIdx, reduced, sw]);
  const fillStyle = useAnimatedStyle(() => ({ width: lineW * sw.value }));

  const sideColor = cinematic ? 'rgba(255,255,255,0.55)' : inkSoft;
  const baseColor = cinematic ? 'rgba(255,255,255,0.35)' : inkFaint;
  const mainColor = cinematic ? '#ffffff' : ink;

  return (
    <Animated.View style={[styles.fill, enterStyle]}>
      {/* The whole stage answers a tap with play/pause — karaoke ergonomics:
          hands on the phone, eyes on the words. Line taps still seek. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? 'pause' : 'play'}
        onPress={onToggle}
        style={styles.karaokeStage}
      >
        {/* True instrumental toggle — accent-filled while the voice is out,
            "preparing" while the server separates it (first time only). */}
        <View pointerEvents="box-none" style={styles.stageTop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="music only"
            accessibilityState={{ selected: musicOnly, busy: preparingStems }}
            onPress={onMusicOnly}
            style={[
              styles.musicOnlyBtn,
              { borderColor: musicOnly || preparingStems ? accent : sideColor },
              musicOnly && { backgroundColor: `${accent}26` },
            ]}
          >
            <Text
              style={[
                styles.musicOnlyText,
                {
                  color: musicOnly || preparingStems ? accent : sideColor,
                },
              ]}
            >
              {preparingStems
                ? 'preparing music… tap to cancel'
                : 'music only'}
            </Text>
          </Pressable>
        </View>
        <View style={styles.karaokeSlot}>
          {prevLine && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={lineFor(prevLine)}
              onPress={() => onSeekLine(prevLine)}
            >
              <Text
                numberOfLines={2}
                style={[styles.karaokeSide, { color: sideColor }]}
              >
                {lineFor(prevLine)}
              </Text>
            </Pressable>
          )}
        </View>
        <View style={styles.karaokeMain}>
          {current ? (
            <View onLayout={e => setLineW(e.nativeEvent.layout.width)}>
              {/* The same string twice: a quiet base with the accent copy
                  over it, clipped by an animated width — the fill sweep. */}
              <Text style={[styles.karaokeLine, { color: baseColor }]}>
                {lineFor(current)}
              </Text>
              <Animated.View
                pointerEvents="none"
                style={[styles.karaokeFill, fillStyle]}
              >
                <Text
                  style={[
                    styles.karaokeLine,
                    styles.karaokeGlow,
                    {
                      color: accent,
                      textShadowColor: `${accent}66`,
                      width: lineW || undefined,
                    },
                  ]}
                >
                  {lineFor(current)}
                </Text>
              </Animated.View>
            </View>
          ) : countdown != null ? (
            <View style={styles.countdownWrap}>
              <CountdownDots remain={countdown} accent={accent} />
              {nextUp && (
                <Text style={[styles.karaokeLine, { color: baseColor }]}>
                  {lineFor(nextUp)}
                </Text>
              )}
            </View>
          ) : showMark ? (
            <GapMark accent={accent} reduced={reduced} />
          ) : resting ? (
            <Text style={[styles.karaokeLine, { color: baseColor }]}>
              {lineFor(resting)}
            </Text>
          ) : waiting ? (
            <Text style={[styles.karaokeLine, { color: mainColor }]}>
              {lineFor(waiting)}
            </Text>
          ) : null}
        </View>
        {/* Paused cue — a fixed slot so the stage never jumps. */}
        <View style={styles.karaokeCue}>
          {!playing && (
            <Text style={[styles.karaokeCueText, { color: sideColor }]}>
              paused — tap the words to continue
            </Text>
          )}
        </View>
        <View style={styles.karaokeSlot}>
          {preview && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={lineFor(preview)}
              onPress={() => onSeekLine(preview)}
            >
              <Text
                numberOfLines={2}
                style={[styles.karaokeSide, { color: sideColor }]}
              >
                {lineFor(preview)}
              </Text>
            </Pressable>
          )}
        </View>
        {/* Glass gesture hint, player-chip style — shown until the stage tap
            has been performed once. Paused hides it: the cue teaches then. */}
        {stageHint && playing && (
          <View pointerEvents="none" style={styles.stageHint}>
            <Glass radius={999} style={styles.stageHintChip}>
              <View style={styles.stageHintRow}>
                <Icon name="pause" size={12} color={accent} />
                <Text style={[styles.stageHintText, { color: mainColor }]}>
                  tap the words to pause
                </Text>
              </View>
            </Glass>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

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
  const open = player.ui?.lyricsOpen ?? false;
  // 4Hz only while shown — same background-churn rule as PlayerSheet.
  const { position, duration } = usePlaybackProgress(open ? 250 : 60_000);
  const reduced = useReducedMotion();

  const track = player.current;

  const [vis, setVis] = useState('closed'); // 'closed' | 'open' | 'closing'
  const [hit, setHit] = useState({ trackId: null, data: null, error: null });
  const [view, setView] = useState('en'); // 'en' = romanized, 'orig' = original
  const [cinematic, setCinematic] = useState(false);
  // Karaoke stage on/off — a presentation mode over the same synced lines.
  const [karaoke, setKaraoke] = useState(false);
  // The pill pulses (and a one-line hint sits under the header) until the
  // user actually enters karaoke once — in-place discovery, not a tour card.
  const karaokeHintOn = useHintActive(HINT_KARAOKE);

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
      // Every open starts romanized, like the web's fresh mount — and on the
      // reading view, not karaoke.
      setView('en');
      setKaraoke(false);
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
  // Hold a line to send it on — quoted, credited, linked (lib/share).
  const shareLine = useCallback(text => shareLyric(track, text), [track]);
  // The karaoke stage's tap-to-play/pause, behind the same wake guard.
  // Actually toggling is the moment the gesture counts as learned.
  const togglePlay = player.togglePlay;
  const stageHintOn = useHintActive(HINT_STAGE_TAP);
  const onStageToggle = useCallback(() => {
    if (cinRef.current || Date.now() - wokeAt.current < 400) {
      return;
    }
    markHintDone(HINT_STAGE_TAP);
    togglePlay?.();
  }, [togglePlay]);

  // Karaoke "music only" — the true instrumental, separated once server-side
  // and cached for everyone. Tapping the stage pill starts the preparation;
  // the poll below rides it (first request can take minutes on the free
  // queue) and swaps the source the moment it's ready. Leaving karaoke,
  // closing the lyrics, or a track change always lands back on the full mix.
  const musicOnly = !!player.musicOnly;
  const setMusicOnlySrc = player.setMusicOnly;
  // Preparation is pinned to the track it's FOR — so a track change (which
  // swaps trackId) can never let this effect fire a stems request for the new
  // song, and the pill only reads "preparing" on the track being prepared.
  const [preparingId, setPreparingId] = useState(null);
  const preparingStems = !!trackId && preparingId === trackId;
  const toggleMusicOnly = useCallback(() => {
    if (cinRef.current || Date.now() - wokeAt.current < 400) {
      return;
    }
    if (preparingStems) {
      setPreparingId(null); // tapping again cancels the wait
      showToast('stopped preparing.');
      return;
    }
    if (musicOnly) {
      setMusicOnlySrc?.(null);
      return;
    }
    setPreparingId(trackId);
  }, [preparingStems, musicOnly, setMusicOnlySrc, trackId]);

  useEffect(() => {
    if (preparingId !== trackId || !trackId || !karaoke) {
      return undefined;
    }
    let live = true;
    let errs = 0; // consecutive transient failures — give up only after a few
    const ctl = new AbortController();
    const tick = async () => {
      const res = await requestStems(trackId, { signal: ctl.signal }).catch(
        () => null,
      );
      if (!live || !res) {
        return;
      }
      if (res.status === 'done' && res.url) {
        setPreparingId(null);
        setMusicOnlySrc?.(res.url);
        showToast('music only — voice removed.');
      } else if (res.status === 'failed') {
        setPreparingId(null);
        showToast("couldn't make a music-only version — try again later.");
      } else if (res.status === 'unavailable') {
        setPreparingId(null);
        showToast("music only isn't set up yet.");
      } else if (res.status === 'error') {
        // One dropped poll doesn't mean the server-side job failed — the
        // separation is still running. Keep riding it; only give up if the
        // network stays down for several polls in a row.
        errs += 1;
        if (errs >= 4) {
          setPreparingId(null);
          showToast("couldn't reach the server — try again later.");
        }
      } else if (res.status === 'waiting' || res.status === 'preparing') {
        errs = 0; // genuine in-progress — reset the error streak, keep polling
      } else {
        // A malformed 'done' (no url) or any unrecognized status — don't spin
        // forever; count it against the same cap as a transient error.
        errs += 1;
        if (errs >= 4) {
          setPreparingId(null);
          showToast("couldn't make a music-only version — try again later.");
        }
      }
    };
    tick();
    const id = setInterval(tick, STEMS_POLL_MS);
    return () => {
      live = false;
      ctl.abort();
      clearInterval(id);
    };
  }, [preparingId, trackId, karaoke, setMusicOnlySrc]);

  // Preparation is pinned to one track — a plain track change abandons it
  // (the poll gate already blocks a cross-track request) so returning to the
  // old track later never silently re-arms and auto-enables music-only.
  useEffect(() => {
    setPreparingId(cur => (cur == null || cur === trackId ? cur : null));
  }, [trackId]);

  // Music-only is a stage thing: leaving karaoke or the lyrics reverts it.
  useEffect(() => {
    if (karaoke && open) {
      return;
    }
    setPreparingId(null);
    if (musicOnly) {
      setMusicOnlySrc?.(null);
    }
  }, [karaoke, open, musicOnly, setMusicOnlySrc]);

  if ((!open && vis !== 'closing') || !track) {
    return null;
  }

  const cover = artUrl(track);
  // The ambient layer is blurred to a wash — a 150px source is ~11× cheaper
  // to decode/blur/upload than 500px, and radius 14/150 ≈ the old 48/500.
  const coverSoft = artUrl(track, 150);
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
              source={{ uri: coverSoft }}
              blurRadius={14}
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
                {/* Karaoke needs timings — the pill only exists on synced
                    lyrics. It pulses until the user has entered once. */}
                {!!data?.synced && (
                  <HintPulse active={karaokeHintOn && !karaoke && !reduced}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={karaoke ? 'exit karaoke' : 'karaoke'}
                      onPress={() => {
                        markHintDone(HINT_KARAOKE);
                        setKaraoke(k => !k);
                      }}
                      style={[
                        styles.karaokeBtn,
                        {
                          borderColor:
                            karaoke || karaokeHintOn ? t.accent : t.line,
                        },
                        karaoke && { backgroundColor: t.accentSoft },
                      ]}
                    >
                      <Text
                        style={[
                          styles.karaokeBtnText,
                          { color: karaoke ? t.accent : t.inkSoft },
                        ]}
                      >
                        karaoke
                      </Text>
                    </Pressable>
                  </HintPulse>
                )}
                {hasEnglish && (
                  <ViewToggle
                    view={effectiveView}
                    language={track.language || 'original'}
                    onChange={setView}
                    t={t}
                  />
                )}
              </View>
              {/* One-line in-place hint — gone forever after first entry. */}
              {!!data?.synced && karaokeHintOn && !karaoke && (
                <Text style={[styles.hintLine, { color: t.inkFaint }]}>
                  new — tap karaoke to sing along, line by line.
                </Text>
              )}
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

          {status === 'ok' &&
            data.available &&
            data.synced &&
            (karaoke ? (
              <KaraokeView
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
                onToggle={onStageToggle}
                stageHint={stageHintOn}
                musicOnly={musicOnly}
                preparingStems={preparingStems}
                onMusicOnly={toggleMusicOnly}
              />
            ) : (
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
                onShareLine={shareLine}
                onWakeScroll={wake}
              />
            ))}

          {status === 'ok' && data.available && !data.synced && !data.pending && (
            <PlainView
              lines={data.lines}
              view={effectiveView}
              inkSoft={t.inkSoft}
              inkFaint={t.inkFaint}
              onShareLine={shareLine}
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
  karaokeBtn: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 8,
  },
  karaokeBtnText: {
    fontFamily: fonts.medium,
    fontSize: 11.5,
  },
  // The karaoke stage — three fixed slots so the layout never jumps as lines
  // hand over: previous (dim), the big swept line, next (dim).
  karaokeStage: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 26,
    gap: 24,
  },
  karaokeSlot: {
    minHeight: 52,
    justifyContent: 'center',
  },
  karaokeMain: {
    minHeight: 132,
    justifyContent: 'center',
    alignItems: 'center',
  },
  karaokeLine: {
    fontFamily: fonts.semibold,
    fontSize: 34,
    lineHeight: 44,
    textAlign: 'center',
    letterSpacing: -0.34,
  },
  // Soft same-hue halo on the swept copy — the eye rides the fill.
  karaokeGlow: {
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
  },
  karaokeFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  karaokeSide: {
    fontFamily: fonts.medium,
    fontSize: 16.5,
    lineHeight: 23,
    textAlign: 'center',
  },
  karaokeCue: {
    minHeight: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  karaokeCueText: {
    fontFamily: fonts.medium,
    fontSize: 12.5,
  },
  countdownWrap: {
    alignItems: 'center',
    gap: 16,
    alignSelf: 'stretch',
  },
  countdown: {
    flexDirection: 'row',
    gap: 11,
  },
  countdownDot: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
  },
  stageTop: {
    position: 'absolute',
    top: 14,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  musicOnlyBtn: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 5,
  },
  musicOnlyText: {
    fontFamily: fonts.medium,
    fontSize: 11.5,
  },
  stageHint: {
    position: 'absolute',
    bottom: 18,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  stageHintChip: {
    overflow: 'hidden',
  },
  stageHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  stageHintText: {
    fontFamily: fonts.medium,
    fontSize: 11.5,
  },
  hintLine: {
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
