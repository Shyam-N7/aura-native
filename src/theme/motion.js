// The web's motion vocabulary (durations/easings lifted from animations.css and the
// component css) mapped to reanimated. Overshooting cubic-beziers become springs —
// a bezier can't overshoot in reanimated's withTiming, springs are the honest match.
import { Easing } from 'react-native-reanimated';

export const EASE = {
  settle: Easing.bezier(0.2, 0.7, 0.2, 1), // the house curve (aura-rise, dots, bud)
  enter: Easing.bezier(0.215, 0.61, 0.355, 1), // GSAP power3.out equivalent
  exit: Easing.bezier(0.4, 0, 0.2, 1),
};

export const SPRING = {
  sheet: { mass: 1, stiffness: 260, damping: 30 }, // player slide-up, settles ~350ms
  snapback: { mass: 1, stiffness: 300, damping: 26 }, // gesture releases, no bounce-past
};

export const DUR = {
  press: 120,
  dot: 200,
  sheetOut: 300,
  toastIn: 320,
  upNext: 340,
  bud: 380,
  travel: 560, // directional track-change glide (the filmstrip)
  screen: 420,
  authRise: 600,
  crossfade: 900,
  breathe: 2800,
  toastHold: 1600,
};

export const PRESS = { default: 0.94, disc: 0.86 };
