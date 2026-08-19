import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { getAnimatedStyle } from 'react-native-reanimated';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { BgPlayRail } from '../src/components/home/BgPlayRail';
import { GestureTourOverlay } from '../src/components/player/GestureTourOverlay';
import { endTour, startTour } from '../src/lib/gestureTour';
import { storage } from '../src/storage/mmkv';

// The gate is a convention until something checks it. These tests hold the
// two halves of the contract to the loops that used to ignore them:
//   · reduced motion  → no infinite animation is ever STARTED, and the value
//                       sits on its final resting position, not part-way;
//   · app backgrounded / screen blurred → the loop stops, and comes back.
//
// Every loop in the app is a withRepeat(..., -1), so counting withRepeat
// calls counts running loops directly. The reanimated mock below wraps the
// real implementations — nothing about the animation behaviour changes, the
// calls are just recorded — and feeds useReducedMotion from a switch the
// tests own (reanimated reads the system flag once, at import).
global.__gateReduced = false;
global.__gateRepeats = [];
global.__gateTimings = [];
global.__gateShared = [];
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated');
  return {
    ...actual,
    // Not enumerable on the real module, so the spread drops it — and without
    // it the default import (Animated) comes back double-wrapped.
    __esModule: true,
    useReducedMotion: () => global.__gateReduced,
    withRepeat: (...args) => {
      global.__gateRepeats.push(args);
      return actual.withRepeat(...args);
    },
    // getAnimatedStyle only reflects ANIMATED updates, so a value the gate
    // assigns directly (the reduced-motion path) is invisible to it. Record
    // the shared values themselves — that is the only channel that sees a
    // plain assignment, and it is what 'parks on its final value' means.
    useSharedValue: init => {
      const sv = actual.useSharedValue(init);
      if (!global.__gateShared.includes(sv)) global.__gateShared.push(sv);
      return sv;
    },
    withTiming: (...args) => {
      global.__gateTimings.push(args);
      return actual.withTiming(...args);
    },
  };
});

// AppState under jest never leaves 'active'; the gate's app-visibility input
// is swapped for a switch so a background can actually be staged.
global.__gateAppActive = true;
jest.mock('../src/hooks/useAppActive', () => ({
  useAppActive: () => global.__gateAppActive,
}));

const render = async ui => {
  let tree;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{ui}</ThemeProvider>);
  });
  return tree;
};

beforeEach(() => {
  global.__gateReduced = false;
  global.__gateAppActive = true;
  global.__gateRepeats = [];
  global.__gateTimings = [];
  endTour();
  storage.removeItem('aura.gestureTourDone');
});

// ── BgPlayRail: nine EQ bars, previously ungated on reduced motion ─────────

test('the EQ bars loop while background play is on and the app is up', async () => {
  const tree = await render(<BgPlayRail value onPress={() => {}} />);
  // One infinite loop per bar.
  expect(global.__gateRepeats).toHaveLength(9);
  expect(global.__gateRepeats.every(([, count]) => count === -1)).toBe(true);
  await ReactTestRenderer.act(() => tree.unmount());
});

test('reduced motion stops the EQ loop and parks the bars on their final value', async () => {
  global.__gateReduced = true;
  const tree = await render(<BgPlayRail value onPress={() => {}} />);

  // Nothing loops...
  expect(global.__gateRepeats).toHaveLength(0);
  // ...and nothing eases either: the bars and the knob are ASSIGNED their
  // final positions, so a reduced-motion listener never sees a value
  // mid-flight (the "lands instantly, never hidden" half of the contract).
  expect(global.__gateTimings).toHaveLength(0);

  // The bars are visible at full extension — the switch is on, so scaleX 1
  // is the resting value, not a hidden or half-drawn one.
  const bars = tree.root.findAll(
    n => typeof n.type === 'string' && n.props.style?.[0]?.height === 2.5,
  );
  expect(bars).toHaveLength(9);
  // Nine bars, nine shared values, every one sitting at full extension —
  // the switch is on, so 1 is the resting value, not a hidden or half-drawn
  // one. Read off the shared values rather than getAnimatedStyle, which only
  // reports animated updates and cannot see an assignment.
  const parked = global.__gateShared.filter(sv => sv.value === 1);
  expect(parked).toHaveLength(9);
  await ReactTestRenderer.act(() => tree.unmount());
});

test('backgrounding the app stops the EQ loop', async () => {
  global.__gateAppActive = false;
  const tree = await render(<BgPlayRail value onPress={() => {}} />);
  expect(global.__gateRepeats).toHaveLength(0);
  await ReactTestRenderer.act(() => tree.unmount());
});

// ── GestureTourOverlay: the five-loop tour, previously ungated on both ─────

const TARGETS = { art: { x: 20, y: 40, width: 200, height: 200 } };

test('the tour acts its gesture out while it is on screen', async () => {
  startTour();
  const tree = await render(<GestureTourOverlay targets={TARGETS} />);
  // Step one is the double-tap: two ripple rings plus the breathing ring.
  expect(global.__gateRepeats.length).toBeGreaterThan(0);
  expect(global.__gateRepeats.every(([, count]) => count === -1)).toBe(true);
  await ReactTestRenderer.act(() => tree.unmount());
});

test('a tour left open with the app backgrounded runs nothing', async () => {
  startTour();
  global.__gateAppActive = false;
  const tree = await render(<GestureTourOverlay targets={TARGETS} />);
  expect(global.__gateRepeats).toHaveLength(0);
  await ReactTestRenderer.act(() => tree.unmount());
});

test('the tour picks its loops back up when the app returns', async () => {
  startTour();
  global.__gateAppActive = false;
  const tree = await render(<GestureTourOverlay targets={TARGETS} />);
  expect(global.__gateRepeats).toHaveLength(0);

  global.__gateAppActive = true;
  await ReactTestRenderer.act(() => {
    tree.update(
      <ThemeProvider>
        <GestureTourOverlay targets={TARGETS} />
      </ThemeProvider>,
    );
  });
  expect(global.__gateRepeats.length).toBeGreaterThan(0);
  await ReactTestRenderer.act(() => tree.unmount());
});

test('reduced motion stops the tour loops too', async () => {
  startTour();
  global.__gateReduced = true;
  const tree = await render(<GestureTourOverlay targets={TARGETS} />);
  expect(global.__gateRepeats).toHaveLength(0);
  await ReactTestRenderer.act(() => tree.unmount());
});
