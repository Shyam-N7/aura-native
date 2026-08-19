import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

const motion = { reduced: false };
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated');
  return {
    ...actual,
    __esModule: true,
    default: actual.default,
    useReducedMotion: () => motion.reduced,
  };
});

const { RowArrive } = require('../src/components/ui/RowArrive');

const render = async ui => {
  let tree;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(ui);
  });
  return tree;
};

const flat = style =>
  Object.assign({}, ...[].concat(style ?? []).filter(Boolean));

const wrapperStyle = tree => flat(tree.toJSON().props.style);

const riseOf = style =>
  (style.transform ?? []).reduce(
    (y, t) => (t && 'translateY' in t ? t.translateY : y),
    undefined,
  );

afterEach(() => {
  motion.reduced = false;
});

test('reduced motion parks the row at its final value', async () => {
  motion.reduced = true;
  // A late position: under reduced motion even the last row of a wave is
  // simply there, with no stagger to wait out and nothing to catch up to.
  const tree = await render(
    <RowArrive i={40}>
      <Text>row</Text>
    </RowArrive>,
  );
  const style = wrapperStyle(tree);
  expect(style.opacity).toBe(1);
  expect(riseOf(style)).toBe(0);
  await ReactTestRenderer.act(() => tree.unmount());
});

test('reduced motion parks it even when the caller asks to animate', async () => {
  motion.reduced = true;
  const tree = await render(
    <RowArrive animate i={2}>
      <Text>row</Text>
    </RowArrive>,
  );
  const style = wrapperStyle(tree);
  expect(style.opacity).toBe(1);
  expect(riseOf(style)).toBe(0);
  await ReactTestRenderer.act(() => tree.unmount());
});

test('animate={false} parks it too — a settled row never re-arrives', async () => {
  const tree = await render(
    <RowArrive animate={false} i={3}>
      <Text>row</Text>
    </RowArrive>,
  );
  const style = wrapperStyle(tree);
  expect(style.opacity).toBe(1);
  expect(riseOf(style)).toBe(0);
  await ReactTestRenderer.act(() => tree.unmount());
});

// Without this the reduced-motion assertions above would pass against a
// component that never animates at all.
test('with motion on, an arriving row starts hidden and below its slot', async () => {
  const tree = await render(
    <RowArrive i={0}>
      <Text>row</Text>
    </RowArrive>,
  );
  const style = wrapperStyle(tree);
  expect(style.opacity).toBe(0);
  expect(riseOf(style)).toBeGreaterThan(0);
  await ReactTestRenderer.act(() => tree.unmount());
});

// The `animate` flip must restyle the row, never remount it: a remount would
// blink every already-settled row the moment an import stream ends.
//
// Comparing the rendered tree before and after cannot prove this — the output
// is identical either way, so the assertion passed whether React reused the
// row or threw it away. Count mounts instead: only a real remount runs the
// child's mount effect twice.
test('flipping animate restyles the row instead of remounting it', async () => {
  let mounts = 0;
  function Probe() {
    React.useEffect(() => {
      mounts += 1;
    }, []);
    return <Text>row</Text>;
  }
  const tree = await render(
    <RowArrive animate i={1}>
      <Probe />
    </RowArrive>,
  );
  const before = tree.toJSON();
  expect(mounts).toBe(1);

  await ReactTestRenderer.act(() => {
    tree.update(
      <RowArrive animate={false} i={1}>
        <Probe />
      </RowArrive>,
    );
  });

  // The row survived the flip: same element instance, so the child never
  // unmounted and every settled row above it stays on screen.
  expect(mounts).toBe(1);
  const after = tree.toJSON();
  expect(after.type).toBe(before.type);
  expect(JSON.stringify(after.children)).toBe(JSON.stringify(before.children));
  await ReactTestRenderer.act(() => tree.unmount());
});

// A CONTRACT LOCK on the cap, which is the whole point of item M4: YouScreen's
// stagger used to be uncapped, so the 40th card waited 2.8 seconds while the
// identical row on a streaming playlist waited 420ms.
test('the stagger is capped so a big wave lands as a cascade', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'ui', 'RowArrive.jsx'),
    'utf8',
  );
  // The component's own comments QUOTE the anti-pattern in order to explain
  // it, so a raw text match reads the explanation as a violation. Strip both
  // comment forms first (listRowStability.test.js does the same).
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  expect(code).toContain('const STAGGER_CAP = 6;');
  expect(code).toContain('STAGGER_MS * Math.min(i, STAGGER_CAP)');
  // Never an entering= layout animation — reanimated 4.2.3 on Fabric aborts
  // natively when a view is removed mid-entering, and the row must be able to
  // stop arriving without remounting.
  expect(code).not.toMatch(/entering=/);
  expect(code).toContain('cancelAnimation(v)');
});
