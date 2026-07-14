import React from 'react';
import { Canvas, Group, Paint, Blur, ColorMatrix } from '@shopify/react-native-skia';

// Real metaball goo — the same pipeline as the web's SVG filters (GooFilter.jsx):
// gaussian blur, then an alpha threshold via color matrix. Skia's ColorMatrix uses
// the SVG normalized convention, so the web's exact numbers port 1:1.
const VARIANTS = {
  subtle: { sigma: 5, boost: 19, cut: -8 },
  radio: { sigma: 8, boost: 20, cut: -10 },
  strong: { sigma: 10, boost: 18, cut: -7 },
  dial: { sigma: 7, boost: 19, cut: -8 },
};

// prettier-ignore
const matrixFor = ({ boost, cut }) => [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, boost, cut,
];

// Children must be Skia elements (Circle/RoundedRect/...) drawn in OPAQUE fills —
// the threshold eats semi-transparency. Keep the canvas as small as the effect.
export function Goo({ variant = 'subtle', style, children }) {
  const v = VARIANTS[variant] ?? VARIANTS.subtle;
  return (
    <Canvas style={style} pointerEvents="none">
      <Group
        layer={
          <Paint>
            <Blur blur={v.sigma} />
            <ColorMatrix matrix={matrixFor(v)} />
          </Paint>
        }
      >
        {children}
      </Group>
    </Canvas>
  );
}
