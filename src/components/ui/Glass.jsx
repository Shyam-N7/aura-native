import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeContext';
import { glass, glassTint, gooFill } from '../../theme/tokens';

// The web's glass recipe without backdrop-filter: a translucent surface tint,
// then the 135° white shimmer gradient, hairline border, and a 1px top light
// (the CSS inset highlight). Native capture-based blur proved broken on-device
// (it paints the white window background instead of the content behind), and
// over AURA's flat theme backgrounds a tint is visually identical to blur.
// `solid` swaps the tint for an opaque fill — used during goo windows (the
// metaball needs alpha to merge against). NEVER add elevation here: Android
// renders an elevated translucent view as an opaque white slab.
export function Glass({ radius = 26, style, solid = false, children }) {
  const { name } = useTheme();
  const g = name === 'midnight' ? { ...glass, ...glass.midnight } : glass;

  return (
    <View
      style={[
        styles.shell,
        {
          borderRadius: radius,
          borderColor: g.border,
          backgroundColor: solid ? gooFill[name] : glassTint[name],
        },
        style,
      ]}
    >
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          {/* Solid stopColor + numeric stopOpacity — rn-svg renders rgba() stop
              strings opaque on Android, which painted the whole pill white. */}
          <LinearGradient id="shimmer" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#ffffff" stopOpacity={g.shimmerFrom} />
            <Stop offset="1" stopColor="#ffffff" stopOpacity={g.shimmerTo} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#shimmer)" />
      </Svg>
      <View
        pointerEvents="none"
        style={[styles.insetLight, { backgroundColor: g.insetLight }]}
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
});
