import React from 'react';
import { StyleSheet, View } from 'react-native';
import { BlurView } from '@sbaiahmed1/react-native-blur';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeContext';
import { glass, gooFill, elevation } from '../../theme/tokens';

// The web's glass recipe, layered exactly: backdrop blur, then the 135° white
// shimmer gradient, hairline border, and a 1px top light (the CSS inset highlight).
// `solid` swaps blur for an opaque fill — used during goo windows (the metaball
// needs alpha to merge against) and as the automatic pre-Android-12 fallback.
export function Glass({ radius = 26, style, solid = false, elevated = true, children }) {
  const { name, t } = useTheme();
  const g = name === 'midnight' ? { ...glass, ...glass.midnight } : glass;

  return (
    <View
      style={[
        { borderRadius: radius, borderWidth: 1, borderColor: g.border, overflow: 'hidden' },
        solid && { backgroundColor: gooFill[name] ?? t.surface },
        elevated && elevation.glass,
        style,
      ]}
    >
      {!solid && (
        <BlurView
          blurType={name === 'midnight' ? 'dark' : 'light'}
          blurAmount={g.blurAmount}
          style={StyleSheet.absoluteFill}
        />
      )}
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id="shimmer" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={g.gradFrom} />
            <Stop offset="1" stopColor={g.gradTo} />
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
  insetLight: { position: 'absolute', top: 0, left: 10, right: 10, height: 1, opacity: 0.9 },
});
