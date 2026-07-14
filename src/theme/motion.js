// The web's motion vocabulary (durations/easings lifted from animations.css and the
// component css) mapped to reanimated. Overshooting cubic-beziers become springs —
// a bezier can't overshoot in reanimated's withTiming, springs are the honest match.
import { Easing } from 'react-native-reanimated';

export const EASE = {
  settle: Easing.bezier(0.2, 0.7, 0.2, 1), // the house curve (aura-rise, dots, bud)
  enter: Easing.bezier(0.215, 0.61, 0.355, 1), // GSAP power3.out equivalent
  search: Easing.bezier(0.22, 1, 0.36, 1),
  toast: Easing.bezier(0.4, 0, 0.8, 1),
  exit: Easing.bezier(0.4, 0, 0.2, 1),
  rise: Easing.bezier(0.22, 0.61, 0.36, 1),
};

export const SPRING = {
  bloom: { mass: 1, stiffness: 200, damping: 18 }, // ≈ cubic(.34,1.28,.5,1) @460ms
  morph: { mass: 1, stiffness: 250, damping: 17 }, // ≈ cubic(.34,1.32,.5,1) @380ms
  snapback: { mass: 1, stiffness: 300, damping: 26 }, // gesture releases, no bounce-past
};

export const DUR = {
  press: 120,
  dot: 200,
  toastIn: 320,
  upNext: 340,
  bud: 380,
  screen: 420,
  bloom: 460,
  searchIn: 460,
  authRise: 600,
  crossfade: 900,
  breathe: 2800,
  toastHold: 1600,
};

export const PRESS = { default: 0.94, disc: 0.86 };
