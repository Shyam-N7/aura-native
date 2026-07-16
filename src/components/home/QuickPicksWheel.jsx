import React, { useEffect } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withDelay,
  withRepeat,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { TrackArt } from '../TrackRow';
import { useTheme } from '../../theme/ThemeContext';
import { fonts, label } from '../../theme/tokens';
import { cleanTitle } from '../../utils/title';

// The web QuickPicksSpinner rebuilt as a native fidget wheel: discs on a ring
// you can grab and spin (friction coast on release), tap a disc to play.
// Geometry ports the web CSS: ring min(330, 84vw), discs 24% of the ring on a
// 38%-radius circle starting at -90°. Web's manual scroll-vs-spin intent lock
// is replaced by gesture config: horizontal-ish drags spin, vertical drags
// fall through to the page ScrollView.
//
// Web's eight picks, but discs at 20% of the ring (web: 24%) and titles on ONE
// line: at 24% a 100px title box always sat buried under a neighbouring disc's
// artwork (~two titles unreadable at any rotation). Shrinking the art clears
// every title past every disc by ~5px while keeping all eight suggestions —
// field feedback picked density over bigger art when titles stay readable.
export const DISC_COUNT = 8;
// Web coast: velocity × 0.96 per 60Hz frame, capped at 46°/frame. withDecay's
// deceleration is per-ms: 0.96^60 per second → 0.9976^1000.
const DECELERATION = 0.9976;
const MAX_DEG_PER_SEC = 2760;
const HINT_MS = 4200;

function Disc({ track, index, ringSize, rot, playing, accent, ink, onPick }) {
  const reduced = useReducedMotion();
  const discSize = ringSize * 0.2;
  const radius = ringSize * 0.38;
  const angle = (-90 + index * (360 / DISC_COUNT)) * (Math.PI / 180);
  const cx = ringSize / 2 + radius * Math.cos(angle) - discSize / 2;
  const cy = ringSize / 2 + radius * Math.sin(angle) - discSize / 2;
  // Web .aura-qps__name: the title hangs under the disc (150% width, 100px
  // cap) and counter-rotates with it, staying upright while orbiting.
  const nameW = Math.min(discSize * 1.5, 100);

  // Pop-in stagger (55ms per disc, web .aura-qps pop) + counter-rotation so
  // the art stays upright while the ring turns.
  const pop = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    pop.value = withDelay(index * 55, withTiming(1, { duration: 260 }));
  }, [pop, index]);

  const style = useAnimatedStyle(() => ({
    opacity: pop.value,
    transform: [{ rotate: `${-rot.value}deg` }, { scale: playing ? 1.16 : 1 }],
  }));

  return (
    <Animated.View
      style={[
        styles.disc,
        { left: cx, top: cy, width: discSize, height: discSize },
        style,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`play ${cleanTitle(track.title)}`}
        onPress={() => onPick(track)}
        style={[
          styles.discPress,
          playing && [styles.playingRing, { borderColor: accent }],
        ]}
      >
        <TrackArt track={track} size={discSize - (playing ? 8 : 0)} round />
      </Pressable>
      <Text
        numberOfLines={1}
        style={[
          styles.discName,
          {
            top: discSize + 6,
            width: nameW,
            left: (discSize - nameW) / 2,
            color: playing ? accent : ink,
          },
        ]}
      >
        {cleanTitle(track.title)}
      </Text>
    </Animated.View>
  );
}

export function QuickPicksWheel({ tracks, currentId, onPick }) {
  const { t } = useTheme();
  const { width: winW } = useWindowDimensions();
  const reduced = useReducedMotion();

  const ringSize = Math.min(330, winW * 0.84);
  const center = ringSize / 2;
  const hubSize = ringSize * 0.3;

  const rot = useSharedValue(0);
  const prevAngle = useSharedValue(0);
  const breathe = useSharedValue(0.85);
  const hint = useSharedValue(1);

  useEffect(() => {
    if (!reduced) {
      breathe.value = withRepeat(withTiming(1.1, { duration: 1400 }), -1, true);
    }
    hint.value = withDelay(HINT_MS, withTiming(0, { duration: 600 }));
  }, [breathe, hint, reduced]);

  // Grab-and-turn: track the touch's polar angle around the ring center and
  // add each delta to the rotation; on release, coast with the tangential
  // angular velocity. Vertical drags fail over to the page scroll.
  const spin = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-14, 14])
    .onBegin(e => {
      'worklet';
      prevAngle.value = Math.atan2(e.y - center, e.x - center);
    })
    .onUpdate(e => {
      'worklet';
      const a = Math.atan2(e.y - center, e.x - center);
      let d = a - prevAngle.value;
      if (d > Math.PI) {
        d -= 2 * Math.PI;
      } else if (d < -Math.PI) {
        d += 2 * Math.PI;
      }
      prevAngle.value = a;
      rot.value += d * (180 / Math.PI);
    })
    .onEnd(e => {
      'worklet';
      const rx = e.x - center;
      const ry = e.y - center;
      const r = Math.max(24, Math.hypot(rx, ry));
      // Tangential component of the release velocity → angular velocity.
      const omega =
        ((e.velocityX * -(ry / r) + e.velocityY * (rx / r)) / r) *
        (180 / Math.PI);
      const capped = Math.max(
        -MAX_DEG_PER_SEC,
        Math.min(MAX_DEG_PER_SEC, omega),
      );
      rot.value = withDecay({ velocity: capped, deceleration: DECELERATION });
    });

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rot.value}deg` }],
  }));
  const hubStyle = useAnimatedStyle(() => ({
    transform: [{ scale: breathe.value }],
  }));
  const hintStyle = useAnimatedStyle(() => ({ opacity: hint.value }));

  const reason = tracks.find(x => x.id === currentId)?.reason;

  return (
    <View style={styles.wrap}>
      <GestureDetector gesture={spin}>
        <View
          accessibilityLabel="quick picks wheel"
          style={[styles.ringBox, { width: ringSize, height: ringSize }]}
        >
          <View style={[styles.hubWrap, { width: ringSize, height: ringSize }]}>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.hub,
                {
                  width: hubSize,
                  height: hubSize,
                  borderRadius: hubSize / 2,
                  backgroundColor: t.surface,
                  borderColor: t.line,
                },
                hubStyle,
              ]}
            >
              <View style={[styles.hubDot, { backgroundColor: t.accent }]} />
            </Animated.View>
          </View>
          <Animated.View style={[StyleSheet.absoluteFill, ringStyle]}>
            {tracks.map((track, i) => (
              <Disc
                key={track.id}
                track={track}
                index={i}
                ringSize={ringSize}
                rot={rot}
                playing={track.id === currentId}
                accent={t.accent}
                ink={t.inkSoft}
                onPick={onPick}
              />
            ))}
          </Animated.View>
        </View>
      </GestureDetector>
      <Animated.Text style={[label(9.5), { color: t.inkFaint }, hintStyle]}>
        flick to spin
      </Animated.Text>
      {!!reason && (
        <Text numberOfLines={1} style={[styles.reason, { color: t.inkSoft }]}>
          {reason}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10 },
  // The bottom disc's name hangs past the ring box — keep the hint line
  // clear of it (web gives the why-line 28px for the same reason).
  ringBox: { marginBottom: 22 },
  hubWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hub: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  hubDot: { width: 6, height: 6, borderRadius: 3 },
  disc: { position: 'absolute' },
  discPress: { alignItems: 'center', justifyContent: 'center' },
  discName: {
    position: 'absolute',
    textAlign: 'center',
    fontFamily: fonts.semibold,
    fontSize: 9.5,
    lineHeight: 11.5,
  },
  playingRing: { borderWidth: 2, borderRadius: 999 },
  reason: {
    fontFamily: fonts.regular,
    fontSize: 12,
    maxWidth: 300,
    textAlign: 'center',
  },
});
