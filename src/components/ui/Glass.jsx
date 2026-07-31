import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeContext';
import { GlassBackdrop } from './GlassBackdrop';
import { glass, glassTint, glassTintSoft, gooFill } from '../../theme/tokens';

// The web's glass recipe without backdrop-filter: a translucent surface tint,
// then the 135° white shimmer gradient, hairline border, and a 1px top light
// (the CSS inset highlight). Native capture-based blur proved broken on-device
// (it paints the white window background instead of the content behind), and
// over AURA's flat theme backgrounds a tint is visually identical to blur.
// `solid` swaps the tint for an opaque fill — used during goo windows (the
// metaball needs alpha to merge against). `soft` uses the lower-alpha tint for
// chrome floating over scrolling content. `blur` swaps the tint for the REAL
// backdrop (GlassView) with nothing over it but the shimmer — the web's exact
// register — reserved for the two floating bars; it goes dormant while
// `solid` so BlurView and the Skia goo layer never run in the same frame. NEVER add elevation here: Android renders an elevated
// translucent view as an opaque white slab.
export function Glass({
  radius = 26,
  style,
  solid = false,
  soft = false,
  blur = false,
  children,
}) {
  const { name } = useTheme();
  const g = name === 'midnight' ? { ...glass, ...glass.midnight } : glass;
  const blurOn = blur && !solid && GlassBackdrop != null;
  const tint = soft ? glassTintSoft[name] : glassTint[name];

  return (
    <View
      style={[
        styles.shell,
        {
          borderRadius: radius,
          borderColor: g.border,
          // With blur live, the tint moves to an overlay ABOVE the backdrop —
          // a background here would paint beneath it and vanish.
          backgroundColor: solid
            ? gooFill[name]
            : blurOn
              ? 'transparent'
              : tint,
        },
        style,
      ]}
    >
      {/* Web-exact register: the pill over blur carries NO surface tint —
          the shimmer gradient + rim over the blurred backdrop IS the glass,
          and content colour bleeds through at full strength (owner: "match
          the level it is in web"). */}
      {blurOn && (
        <GlassBackdrop
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          collapsable={false}
          blurRadius={g.backdropRadius}
        />
      )}
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          {/* Solid stopColor + numeric stopOpacity — rn-svg renders rgba() stop
              strings opaque on Android, which painted the whole pill white. */}
          <LinearGradient id="shimmer" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#ffffff" stopOpacity={g.shimmerFrom} />
            <Stop offset="1" stopColor="#ffffff" stopOpacity={g.shimmerTo} />
          </LinearGradient>
          {/* The slab's dark under-edge: light entering thick glass dies at
              the bottom. A short fade, not a hairline — the height is what
              sells the thickness. */}
          <LinearGradient id="underShade" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor="#000000" stopOpacity={g.underShade} />
            <Stop offset="1" stopColor="#000000" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#shimmer)" />
        {/* The dark under-edge belongs to the TINT register only: over the
            tintless blur it floats on transparent glass and reads as a line
            across the pill (owner report, survived the radius fix). The web's
            blurred pill carries no shade band — shimmer + rim only. */}
        {!blurOn && (
          <Rect
            x="0"
            y="78%"
            width="100%"
            height="22%"
            fill="url(#underShade)"
          />
        )}
      </Svg>
      <View
        pointerEvents="none"
        style={[styles.insetLight, { backgroundColor: g.insetLight }]}
      />
      <View
        pointerEvents="none"
        style={[styles.insetShade, { backgroundColor: g.insetShade }]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { borderWidth: 1, overflow: 'hidden' },
  insetLight: {
    position: 'absolute',
    top: 0,
    left: 10,
    right: 10,
    height: 1,
    opacity: 0.9,
  },
  insetShade: {
    position: 'absolute',
    bottom: 0,
    left: 10,
    right: 10,
    height: 1,
  },
});
