import { summarizeClock, CLOCK_PARTS } from '../src/lib/musicClock';

// Local-time construction on purpose: summarizeClock buckets by the viewer's
// local hour, so these plays land in known parts of the day on any machine.
const at = h => new Date(2026, 6, 10, h).getTime();
const play = (trackId, h) => ({
  trackId,
  title: trackId,
  artist: 'a',
  imageUrl: null,
  ts: at(h),
});

test('buckets by local hour with the 5/12/17/21 boundaries', () => {
  const clock = summarizeClock([
    play('m1', 5),
    play('m1', 11),
    play('a1', 12),
    play('e1', 17),
    play('e1', 20),
    play('n1', 21),
    play('n2', 2),
    play('n2', 3),
    play('n2', 4),
  ]);
  expect(clock.totalPlays).toBe(9);
  const by = Object.fromEntries(clock.parts.map(p => [p.key, p]));
  expect(by.morning.plays).toBe(2);
  expect(by.afternoon.plays).toBe(1);
  expect(by.evening.plays).toBe(2);
  expect(by.night.plays).toBe(4);
  expect(by.morning.topTracks[0]).toMatchObject({ trackId: 'm1', count: 2 });
  expect(clock.busiest.key).toBe('night');
  // Hours 0–4 are the after-midnight signature; n2 leads with 3 plays.
  expect(clock.afterMidnight).toMatchObject({ trackId: 'n2', count: 3 });
});

test('is calm on empty input', () => {
  const clock = summarizeClock([]);
  expect(clock.totalPlays).toBe(0);
  expect(clock.busiest).toBeNull();
  expect(clock.afterMidnight).toBeNull();
  expect(clock.parts).toHaveLength(CLOCK_PARTS.length);
});

test('perPart caps the tracks listed per part', () => {
  const plays = ['x', 'y', 'z'].flatMap(id => [play(id, 6), play(id, 7)]);
  const clock = summarizeClock(plays, { perPart: 2 });
  const morning = clock.parts.find(p => p.key === 'morning');
  expect(morning.plays).toBe(6);
  expect(morning.topTracks).toHaveLength(2);
});
