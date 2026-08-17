import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Circle } from '@shopify/react-native-skia';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { useAppActive } from '../../hooks/useAppActive';
import { useNavFocused } from '../../hooks/useNavFocused';
import { Goo } from '../ui/Goo';
import { DUR, EASE } from '../../theme/motion';
import { label } from '../../theme/tokens';
import { COPY } from '../../lib/ytImportCopy';

// The import, told as a pour.
//
// Messy YouTube videos flow through the matcher and come out the other side as
// clean AURA tracks — and the app already owns a visual language built for
// exactly that story: the goo metaballs (the dock's bud, AuraLoader). Left
// mass: songs still to match. Right mass: the playlist. Between them, one
// traveller — the song being matched right now — which crosses and FUSES into
// the playlist when a poll lands with the auto count grown.
//
// Two layers, and the split is the whole architecture:
//
//   idle  — plain Animated.Views, transform/opacity only, always mounted.
//   fuse  — a Goo canvas mounted ONLY for the ~700ms of a landing, then torn
//           down. Goo.jsx says "keep the canvas as small as the effect", and
//           the dock — the app's largest goo surface — already mounts its
//           canvas only for a 460ms morph window. A goo filter left running
//           for a whole import would be against both.
//
// The honesty rules, restated for a scene: radius, wobble and breathing claim
// nothing (the same licence AuraLoader's pulse already has). A TRAVEL claims "a
// song just landed", so travels fire only on a real count delta — one per poll,
// with magnitude carried by the mass sizes, which are exact. A dead drain is a
// wobbling traveller that never crosses: working, not progressing.

// Scene geometry. Exported pure so the sizing logic is testable — jest mocks
// Skia, so nothing inside the canvas can be asserted on.
export const SCENE = { w: 320, h: 96, pad: 18 };
const R_MIN = 7;
const R_MAX = 26;
const R_TRAVELLER = 8;

/**
 * Radii and anchors for the three actors, from real counts.
 *
 * sqrt, not linear: a mass holds N songs, and perceived blob AREA is what
 * should track N — linear radius makes 30 songs look nine hundred times the
 * size of one. Clamped so a fresh fetch (all zeros) still renders a legible
 * scene rather than three invisible points.
 */
export function sceneLayout(counts = {}) {
  const remaining = Math.max(0, counts.matching ?? 0);
  const landed = Math.max(0, (counts.auto ?? 0));
  const review = Math.max(0, counts.review ?? 0);
  const total = Math.max(1, counts.total ?? 1);
  const r = n =>
    n === 0 ? R_MIN : R_MIN + (R_MAX - R_MIN) * Math.sqrt(Math.min(1, n / total));
  return {
    left: { x: SCENE.pad + R_MAX, y: SCENE.h / 2, r: r(remaining) },
    right: { x: SCENE.w - SCENE.pad - R_MAX, y: SCENE.h / 2, r: r(landed) },
    traveller: { x: SCENE.w / 2, y: SCENE.h / 2, r: R_TRAVELLER },
    review,
  };
}

// How long the fuse canvas lives: the travel plus a beat for the swell.
const FUSE_MS = DUR.travel + 160;

/**
 * The burst layer. Mounted by the parent for FUSE_MS around a landing, drawing
 * opaque accent circles under the metaball filter: the traveller slides into
 * the right mass and the two fuse. Everything in here is one-shot — no loops,
 * nothing to gate — and the component's whole lifetime is under a second.
 *
 * Opaque fills and radius-only exits, per Goo's contract: the threshold eats
 * semi-transparency, so a fading blob would pop out mid-fade.
 */
function FuseBurst({ layout, accent }) {
  const x = useSharedValue(layout.traveller.x);
  const swell = useSharedValue(layout.right.r);
  useEffect(() => {
    x.value = withTiming(layout.right.x, {
      duration: DUR.travel,
      easing: EASE.settle,
    });
    swell.value = withSequence(
      withTiming(layout.right.r + 3, { duration: DUR.travel }),
      withTiming(layout.right.r, { duration: 160, easing: EASE.exit }),
    );
    return () => {
      cancelAnimation(x);
      cancelAnimation(swell);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Shared values passed straight to Skia props — the AuraLoader idiom.
  return (
    <Goo variant="subtle" style={styles.canvas}>
      <Circle cx={x} cy={layout.traveller.y} r={R_TRAVELLER} color={accent} />
      <Circle cx={layout.right.x} cy={layout.right.y} r={swell} color={accent} />
    </Goo>
  );
}

function Mass({ x, y, size, color, style }) {
  return (
    <Animated.View
      style={[
        styles.mass,
        {
          left: x - size / 2,
          top: y - size / 2,
          width: size,
          height: size,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

export function ImportJourney({ counts, live }) {
  const { t } = useTheme();
  const reduced = useReducedMotion();
  const appActive = useAppActive();
  const focused = useNavFocused();
  const layout = sceneLayout(counts);

  // ONE clock drives every idle motion — masses breathing out of phase, the
  // traveller drifting its slow ellipse, the satellites orbiting. One shared
  // value, several derived styles: the SensingScreen idiom, at scene scale.
  // The user's direction for this round was "always moving": the scene must
  // never freeze between polls. The decoration keeps breathing; the WORDS and
  // COUNTS still move only on real state — that line does not move.
  //
  // Gated on BOTH visibility hooks — this screen's poll keeps running while
  // parked by design (it is the server's worker), so an ungated loop here runs
  // for the whole import invisibly: the reports/10 class, ~40 MB/min.
  const clock = useSharedValue(0.5);
  const breathing = live && appActive && focused && !reduced;
  useEffect(() => {
    if (!breathing) {
      cancelAnimation(clock);
      clock.value = 0.5;
      return undefined;
    }
    clock.value = withRepeat(
      withTiming(1, {
        duration: DUR.breathe,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true,
    );
    return () => cancelAnimation(clock);
  }, [breathing, clock]);

  const travellerStyle = useAnimatedStyle(() => {
    const a = clock.value * Math.PI * 2;
    return {
      opacity: 0.55 + clock.value * 0.45,
      transform: [
        { translateX: Math.sin(a) * 10 },
        { translateY: Math.cos(a) * 4 },
        { scale: 0.88 + clock.value * 0.24 },
      ],
    };
  });
  // The two masses breathe against each other — one swells as the other
  // settles — so the scene reads as alive even when nothing has landed yet.
  const leftBreath = useAnimatedStyle(() => ({
    transform: [{ scale: 0.94 + clock.value * 0.12 }],
  }));
  const rightBreath = useAnimatedStyle(() => ({
    transform: [{ scale: 1.06 - clock.value * 0.12 }],
  }));
  const orbit = useAnimatedStyle(() => ({
    transform: [{ rotate: `${clock.value * 40 - 20}deg` }],
  }));

  // A landing: the auto count grew. Mount the goo canvas for FUSE_MS, hide the
  // idle traveller and right mass underneath it (the dock's silhouette
  // handoff), then tear it down. One burst per poll regardless of how many
  // songs that poll resolved — the delta's magnitude is already carried by the
  // mass sizes, which are exact.
  const auto = counts?.auto ?? 0;
  const prevAuto = useRef(auto);
  const [fusing, setFusing] = useState(false);
  useEffect(() => {
    if (auto > prevAuto.current && appActive && focused && !reduced) {
      setFusing(true);
      const id = setTimeout(() => setFusing(false), FUSE_MS);
      prevAuto.current = auto;
      return () => clearTimeout(id);
    }
    prevAuto.current = auto;
    return undefined;
  }, [auto, appActive, focused, reduced]);

  return (
    <View style={styles.scene} pointerEvents="none">
      <Mass
        x={layout.left.x}
        y={layout.left.y}
        size={layout.left.r * 2}
        color={t.accent}
        style={leftBreath}
      />
      {!fusing && (
        <Mass
          x={layout.traveller.x}
          y={layout.traveller.y}
          size={R_TRAVELLER * 2}
          color={t.accent}
          style={travellerStyle}
        />
      )}
      {!fusing && (
        <Mass
          x={layout.right.x}
          y={layout.right.y}
          size={layout.right.r * 2}
          color={t.accent}
          style={rightBreath}
        />
      )}
      {fusing && <FuseBurst layout={layout} accent={t.accent} />}

      {/* The story, legible: live counts under each mass, so the scene is
          information wearing motion rather than motion wearing a screen. */}
      {(counts?.total ?? 0) > 0 && (
        <>
          <Text
            style={[
              label(7.5),
              styles.massLabel,
              styles.massLabelLeft,
              { width: layout.left.x * 2, color: t.inkFaint },
            ]}
          >
            {COPY.progress.scene.toGo(Math.max(0, counts.matching ?? 0))}
          </Text>
          <Text
            style={[
              label(7.5),
              styles.massLabel,
              {
                left: layout.right.x - (SCENE.w - layout.right.x),
                width: (SCENE.w - layout.right.x) * 2,
                color: t.inkFaint,
              },
            ]}
          >
            {COPY.progress.scene.added(Math.max(0, counts.auto ?? 0))}
          </Text>
        </>
      )}

      {/* The "to check" satellites: real count, worn as a small cluster above
          the playlist mass rather than animated per item — the job view sends
          aggregate deltas, and choreography must not claim more than it knows. */}
      {layout.review > 0 && (
        <Animated.View style={[styles.satellites, { right: SCENE.pad }, orbit]}>
          {Array.from({ length: Math.min(3, layout.review) }, (_, i) => (
            <View
              key={i}
              style={[styles.satellite, { backgroundColor: t.accentSoft }]}
            />
          ))}
          <Text style={[label(7.5), { color: t.inkFaint }]}>
            {layout.review}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scene: {
    width: SCENE.w,
    height: SCENE.h,
    alignSelf: 'center',
  },
  mass: {
    position: 'absolute',
    borderRadius: 999,
  },
  canvas: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SCENE.w,
    height: SCENE.h,
  },
  satellites: {
    position: 'absolute',
    top: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  satellite: { width: 5, height: 5, borderRadius: 999 },
  massLabel: { position: 'absolute', bottom: 0, textAlign: 'center' },
  massLabelLeft: { left: 0 },
});
