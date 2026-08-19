import fs from 'fs';
import path from 'path';
import React from 'react';
import { PixelRatio, StyleSheet } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { storage } from '../src/storage/mmkv';
import {
  QueueSheet,
  rowHeightAt,
  rowLayoutAt,
} from '../src/overlays/QueueSheet';

// The queue's row height used to be a hardcoded 62 that fed BOTH getItemLayout
// and every line of the drag-reorder math. At a large OS font scale the row's
// two stacked text lines outgrow 62dp, so the row the user sees and the row
// the virtualizer computes stop being the same box — and a drag that looks
// like it lands on one track commits to another. The height is now derived
// from PixelRatio.getFontScale(), and these tests hold the three consumers
// (the drawn row, getItemLayout, the drag math) to one number.

jest.mock('react-native-track-player', () => ({
  useProgress: () => ({ position: 30, duration: 120, buffered: 0 }),
}));

const mockQueue = {
  tracks: [
    { id: 'a', title: 'First Song', artist: 'one', durationSec: 100 },
    { id: 'b', title: 'Second Song', artist: 'two', durationSec: 200 },
    { id: 'c', title: 'Third Song', artist: 'three', durationSec: 300 },
  ],
  idx: 1,
  source: 'more like this',
};
jest.mock('../src/playback/PlayerContext', () => ({
  usePlayer: () => ({
    current: mockQueue.tracks[1],
    queue: mockQueue,
    isPlaying: true,
    repeat: 'off',
    shuffleActive: false,
    jumpTo: jest.fn(),
    removeAt: jest.fn(),
    cycleRepeat: jest.fn(),
    toggleShuffle: jest.fn(),
    clearQueue: jest.fn(),
    ui: { queueOpen: true, closeQueue: jest.fn() },
  }),
}));
jest.mock('../src/lib/addToPlaylistSheet', () => ({
  openAddToPlaylist: jest.fn(),
}));
jest.mock('../src/api/playlists', () => ({
  createPlaylist: jest.fn(),
  addToPlaylist: jest.fn(),
}));
jest.mock('../src/lib/confirm', () => ({
  confirm: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('../src/lib/toast', () => ({ showToast: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  storage.removeItem('aura.queueHidePast');
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('the row height derives from the OS font scale', () => {
  test('the default scale renders the row that shipped, to the pixel', () => {
    // The whole point of the guard: a normal user must see no change at all.
    expect(rowHeightAt(1)).toBe(62);
  });

  test('it grows with the scale, and never shrinks below the artwork', () => {
    // Small scales are floored by the 44dp artwork, which is an image and
    // does not scale — the row cannot get shorter than the art plus its room.
    expect(rowHeightAt(0.85)).toBe(62);
    expect(rowHeightAt(1.15)).toBe(64);
    expect(rowHeightAt(1.3)).toBe(70);
    expect(rowHeightAt(2)).toBe(98);
    const scales = [1, 1.15, 1.3, 1.5, 1.85, 2];
    scales.forEach((s, i) => {
      if (i > 0) {
        expect(rowHeightAt(s)).toBeGreaterThanOrEqual(rowHeightAt(scales[i - 1]));
      }
    });
  });

  test('getItemLayout lays the rows end to end at that height', () => {
    const h = rowHeightAt(1.85);
    const layout = rowLayoutAt(h);
    for (let i = 0; i < 6; i += 1) {
      expect(layout(null, i)).toEqual({ length: h, offset: h * i, index: i });
    }
  });
});

// Every node that owns a piece of the geometry — the rows, the picks header,
// the drop line — is handed `rowH`; the worklets that do the drag math read
// it off that prop.
const rowHProps = tree =>
  tree.root
    .findAll(n => n.props && typeof n.props.rowH === 'number', {
      deep: true,
    })
    .map(n => n.props.rowH);

// The height the row is actually DRAWN at, read back off the host view that
// carries the row's own style (borderRadius 10 + the row flex direction).
const drawnRowHeights = tree =>
  tree.root
    .findAll(n => typeof n.type === 'string', { deep: true })
    .map(n => StyleSheet.flatten(n.props.style) || {})
    .filter(s => s.borderRadius === 10 && s.flexDirection === 'row')
    .map(s => s.height);

const listGetItemLayout = tree =>
  tree.root.findAll(
    n => n.props && typeof n.props.getItemLayout === 'function',
    { deep: true },
  )[0].props.getItemLayout;

test('at a large font scale the drawn row, getItemLayout and the drag math all agree', async () => {
  jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1.85);
  const expected = rowHeightAt(1.85);
  // It really did move — otherwise the rest of this asserts nothing.
  expect(expected).toBeGreaterThan(62);

  // Yield to REAL timers once first: reanimated's jest mock prepares its
  // UI-side frame-callback registry on a deferred rAF (a setTimeout(0)) at
  // import, and switching to fake timers before that has landed strands it —
  // the first useFrameCallback registration then throws. Everything after
  // this line runs on one timer implementation, end to end (house pattern —
  // see QueueSheet.test).
  await new Promise(r => setTimeout(r, 0));
  jest.useFakeTimers();
  let tree;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <QueueSheet />
      </ThemeProvider>,
    );
  });
  // Rows mount only once the open spring lands.
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(800);
  });

  // 1. The drag math's number. Every rowH-carrying node got the same one.
  const carried = rowHProps(tree);
  expect(carried.length).toBeGreaterThan(0);
  expect(new Set(carried)).toEqual(new Set([expected]));

  // 2. The number the rows are drawn at.
  const drawn = drawnRowHeights(tree);
  expect(drawn.length).toBeGreaterThan(0);
  expect(new Set(drawn)).toEqual(new Set([expected]));

  // 3. The number the virtualizer lays the list out on.
  const layout = listGetItemLayout(tree);
  expect(layout(null, 0).length).toBe(expected);
  expect(layout(null, 4).offset - layout(null, 3).offset).toBe(expected);

  // The three agree, so a drag of n RENDERED rows resolves to exactly n slots
  // — this is the rounding the pan and the auto-scroll loop both run
  // (`Math.round(dragShift / rowH)`), fed the pixel distance the finger
  // actually travelled over n rows of the list as it is laid out.
  const mathRowH = layout(null, 0).length;
  for (let n = -5; n <= 5; n += 1) {
    const travelled = layout(null, 10 + n).offset - layout(null, 10).offset;
    expect(travelled).toBe(n * drawn[0]);
    expect(Math.round(travelled / mathRowH)).toBe(n);
  }

  await ReactTestRenderer.act(() => tree.unmount());
  jest.useRealTimers();
});

test('the sheet holds the height still for as long as the list is mounted', () => {
  // getItemLayout is a promise about every row's offset and VirtualizedList
  // caches what it is told, so the height may only change between openings.
  // It is read on `open` (the list is unmounted then — `landed` is false
  // until the slide settles) and nowhere else.
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'overlays', 'QueueSheet.jsx'),
    'utf8',
  );
  expect(src.match(/PixelRatio\.getFontScale\(\)/g)).toHaveLength(2);
  expect(src).toMatch(
    /useEffect\(\(\) => \{\s*if \(open\) \{\s*setRowH\(rowHeightAt\(PixelRatio\.getFontScale\(\)\)\);/,
  );
  // And nothing may go back to a hardcoded slot size: the drag-follow
  // rounding, the neighbour shift and the auto-scroll clamp all read rowH.
  expect(src.match(/Math\.round\(dragShift\.value \/ rowH\)/g)).toHaveLength(2);
  // No hardcoded slot size survives anywhere in the code (comments explaining
  // where 62 came from are fine, so strip those first).
  const code = src.replace(/\/\/[^\n]*/g, '');
  expect(code).not.toMatch(/\b62\b/);
});
