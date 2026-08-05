import { ribbonPath } from '../src/components/player/ProgressRibbon';

// The loaded-ahead stroke used to be an <Line> across the centreline. On a
// wave with any amplitude that reads as a separate bar cutting through the
// ribbon rather than as part of it (field screenshot). It now traces the same
// sine as the track and the played stretch, so these tests pin the two things
// that made it wrong: it must curve, and it must sit exactly on top of the
// curve the other two strokes draw.

const H = 60;
const SPAN = 300;
const AMP = 0.3;
const FREQ = 2;
const SAMPLES = 80;

const ys = d =>
  d
    .split(/[ML] /)
    .filter(Boolean)
    .map(p => Number(p.trim().split(' ')[1]));

test('the loaded-ahead stretch curves instead of running flat', () => {
  const d = ribbonPath(0.3 * SAMPLES, 0.9 * SAMPLES, 0, SPAN, H, AMP, FREQ);
  const distinct = new Set(ys(d));

  // The old flat rule produced exactly one y (height / 2) for every point.
  expect(distinct.size).toBeGreaterThan(1);
  expect(distinct.has(H / 2) && distinct.size === 1).toBe(false);
});

test('it lands on the same curve as the track it overlays', () => {
  const phase = 0.7;
  const track = ribbonPath(0, SAMPLES, phase, SPAN, H, AMP, FREQ);
  const seg = ribbonPath(20, 40, phase, SPAN, H, AMP, FREQ);

  // Every coordinate of the segment must appear verbatim in the full track
  // path — same x, same y — or the two strokes visibly separate. Only the
  // leading command differs: the segment opens with M where the track is
  // mid-stroke on L.
  const coords = d =>
    d
      .replace(/[ML] /g, '|')
      .split('|')
      .map(p => p.trim())
      .filter(Boolean);

  expect(coords(seg).length).toBe(21);
  for (const point of coords(seg)) {
    expect(coords(track)).toContain(point);
  }
});

test('a fractional start begins exactly at the requested sample', () => {
  const d = ribbonPath(10.5, 12, 0, SPAN, H, AMP, FREQ);
  const firstX = Number(d.split(' ')[1]);

  expect(firstX).toBeCloseTo(10 + (10.5 / SAMPLES) * SPAN, 1); // PAD = 10
});

// The buffer can read behind the playhead for a beat after a seek. Claiming
// loaded audio there would be a lie, and a backwards path would draw out of
// the thumb.
test('a head behind the start collapses to nothing', () => {
  expect(ribbonPath(40, 10, 0, SPAN, H, AMP, FREQ)).toBe('M 0 0');
});

test('no width yields no path rather than NaN coordinates', () => {
  expect(ribbonPath(0, SAMPLES, 0, 0, H, AMP, FREQ)).toBe('M 0 0');
});

// The line variant flattens the same machinery with amplitude 0; the buffered
// stroke has to flatten with it rather than keep a wave of its own.
test('the line variant stays flat', () => {
  const d = ribbonPath(0, SAMPLES, 1.2, SPAN, H, 0, FREQ);

  expect(new Set(ys(d))).toEqual(new Set([H / 2]));
});
