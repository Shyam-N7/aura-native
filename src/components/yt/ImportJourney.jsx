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
export const SCENE = { w: 300, h: 72, pad: 14 };
const R_MIN = 5;
const R_MAX = 17;
const R_TRAVELLER = 6.5;

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

  // The one loop: the traveller's wobble, meaning only "the client is alive".
  // Gated on BOTH visibility hooks — this screen's poll keeps running while
  // parked by design (it is the server's worker), so an ungated loop here runs
  // for the whole import invisibly: the reports/10 class, ~40 MB/min.
  const wobble = useSharedValue(0.5);
  const breathing = live && appActive && focused && !reduced;
  useEffect(() => {
    if (!breathing) {
      cancelAnimation(wobble);
      wobble.value = 0.5;
      return undefined;
    }
    wobble.value = withRepeat(
      withTiming(1, {
        duration: DUR.breathe / 2,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true,
    );
    return () => cancelAnimation(wobble);
  }, [breathing, wobble]);
  const travellerStyle = useAnimatedStyle(() => ({
    opacity: 0.45 + wobble.value * 0.55,
    transform: [{ scale: 0.82 + wobble.value * 0.36 }],
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
        />
      )}
      {fusing && <FuseBurst layout={layout} accent={t.accent} />}

      {/* The "to check" satellites: real count, worn as a small cluster above
          the playlist mass rather than animated per item — the job view sends
          aggregate deltas, and choreography must not claim more than it knows. */}
      {layout.review > 0 && (
        <View style={[styles.satellites, { right: SCENE.pad }]}>
          {Array.from({ length: Math.min(3, layout.review) }, (_, i) => (
            <View
              key={i}
              style={[styles.satellite, { backgroundColor: t.accentSoft }]}
            />
          ))}
          <Text style={[label(7.5), { color: t.inkFaint }]}>
            {layout.review}
          </Text>
        </View>
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
});
