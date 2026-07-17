import {
  activeIndexFor,
  COUNTDOWN_SEC,
  gapWindows,
  lineSweep,
  MIN_GAP_SEC,
  nextLineIn,
} from '../src/lib/lyricsSync';

const lines = ts => ts.map((t, i) => ({ t, line: `line ${i}` }));

test('activeIndexFor tracks the last line whose timestamp has passed', () => {
  const l = lines([5, 10, 20]);
  expect(activeIndexFor(l, 0)).toBe(-1);
  expect(activeIndexFor(l, 5)).toBe(0);
  expect(activeIndexFor(l, 12)).toBe(1);
  expect(activeIndexFor(l, 99)).toBe(2);
  expect(activeIndexFor([], 10)).toBe(-1);
});

test('intro gap surfaces only during a long intro, after its trigger point', () => {
  const l = lines([12, 20]);
  // Trigger = max(GAP_AFTER_SEC, 12 * 0.4) = 4.8s.
  expect(gapWindows(l, 3, 200, -1).inIntroGap).toBe(false);
  expect(gapWindows(l, 5, 200, -1).inIntroGap).toBe(true);
  expect(gapWindows(l, 11.9, 200, -1).inIntroGap).toBe(true);
  // First line sung — intro over.
  expect(gapWindows(l, 12, 200, 0).inIntroGap).toBe(false);
  // Short intro (< MIN_GAP_SEC) never shows the mark.
  const short = lines([MIN_GAP_SEC - 1, 20]);
  expect(gapWindows(short, 3.5, 200, -1).inIntroGap).toBe(false);
});

test('between gap gives the active line its vocal window before surfacing', () => {
  const l = lines([0, 20]);
  // Gap 20s → trigger = 0 + max(4, 8) = 8s.
  expect(gapWindows(l, 7, 200, 0).inBetweenGap).toBe(false);
  expect(gapWindows(l, 9, 200, 0).inBetweenGap).toBe(true);
  expect(gapWindows(l, 19.9, 200, 0).inBetweenGap).toBe(true);
  // Next line landed — the gap closes.
  expect(gapWindows(l, 20, 200, 1).inBetweenGap).toBe(false);
  // A 4s gap between lines is normal singing, not a break.
  const tight = lines([0, 4, 8]);
  expect(gapWindows(tight, 3.5, 200, 0).inBetweenGap).toBe(false);
});

test('outro gap runs from the last line to the end of the track', () => {
  const l = lines([0, 100]);
  // Outro 30s → trigger = 100 + max(4, 12) = 112s.
  expect(gapWindows(l, 111, 130, 1).inOutroGap).toBe(false);
  expect(gapWindows(l, 113, 130, 1).inOutroGap).toBe(true);
  // No duration known → no outro math.
  expect(gapWindows(l, 113, 0, 1).inOutroGap).toBe(false);
  // Not on the last line → not an outro.
  expect(gapWindows(l, 50, 130, 0).inOutroGap).toBe(false);
});

test('lineSweep interpolates the active line across its window', () => {
  const l = lines([10, 20, 30]);
  expect(lineSweep(l, 10, 200, 0)).toBe(0);
  expect(lineSweep(l, 15, 200, 0)).toBe(0.5);
  expect(lineSweep(l, 20, 200, 1)).toBe(0);
  // Clamped at both ends.
  expect(lineSweep(l, 9, 200, 0)).toBe(0);
  expect(lineSweep(l, 99, 200, 1)).toBe(1);
});

test('nextLineIn opens only across the final countdown window', () => {
  const l = lines([10, 40]);
  // Deep in the gap — no countdown yet.
  expect(nextLineIn(l, 30, 0)).toBeNull();
  // Window opens COUNTDOWN_SEC out and counts down to the line.
  expect(nextLineIn(l, 40 - COUNTDOWN_SEC, 0)).toBe(COUNTDOWN_SEC);
  expect(nextLineIn(l, 38, 0)).toBe(2);
  // Line landed — countdown over.
  expect(nextLineIn(l, 40, 0)).toBeNull();
  // Intro: before the first line, lines[0] is what's coming.
  expect(nextLineIn(l, 7, -1)).toBe(3);
  // Nothing follows the last line.
  expect(nextLineIn(l, 45, 1)).toBeNull();
});

test('lineSweep runs the last line out to the track end', () => {
  const l = lines([10, 20]);
  expect(lineSweep(l, 25, 30, 1)).toBe(0.5);
  // No duration → degenerate window reads as done, never NaN.
  expect(lineSweep(l, 25, 0, 1)).toBe(1);
  // No active line yet → nothing to sweep.
  expect(lineSweep(l, 5, 30, -1)).toBe(0);
});
