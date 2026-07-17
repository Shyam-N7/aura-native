import {
  AUTO_TIERS,
  decide,
  initialAutoState,
} from '../src/lib/autoQuality';

// Drive the pure policy with a clock — one sample every 5s like the engine's
// sampler — and return the state after the sequence.
const run = (state, samples, startAt = 100000, stepMs = 5000) =>
  samples.reduce(
    (s, bufferSec, i) => decide(s, { bufferSec, now: startAt + i * stepMs }),
    state,
  );

test('starts optimistic at the 320 ceiling', () => {
  expect(initialAutoState().tier).toBe(AUTO_TIERS[0]);
  expect(AUTO_TIERS[0]).toBe(320);
});

test('a starving buffer panic-steps down one tier', () => {
  const s = decide(initialAutoState(), { bufferSec: 2, now: 100000 });
  expect(s.tier).toBe(160);
});

test('panic steps are cooldown-limited — no double drop from one bad patch', () => {
  let s = decide(initialAutoState(), { bufferSec: 2, now: 100000 });
  s = decide(s, { bufferSec: 1, now: 105000 }); // 5s later: inside cooldown
  expect(s.tier).toBe(160);
  s = decide(s, { bufferSec: 1, now: 116000 }); // past the 15s cooldown
  expect(s.tier).toBe(96);
});

test('96 is the floor — panic never goes below it', () => {
  let s = { tier: 96, healthySince: null, lastStepAt: 0 };
  s = decide(s, { bufferSec: 0, now: 100000 });
  expect(s.tier).toBe(96);
});

test('a sustained healthy buffer steps back up one tier at a time', () => {
  let s = { tier: 96, healthySince: null, lastStepAt: 0 };
  // 7 healthy samples = 30s of continuous >25s buffer.
  s = run(s, [30, 30, 30, 30, 30, 30, 30]);
  expect(s.tier).toBe(160);
  // The streak resets after a step — the next tier needs its own 30s.
  expect(s.healthySince).toBeNull();
  s = run(s, [30, 30, 30, 30, 30, 30, 30], 140000);
  expect(s.tier).toBe(320);
});

test('an interrupted health streak does not step up', () => {
  let s = { tier: 160, healthySince: null, lastStepAt: 0 };
  // Healthy for 20s, dips to middle ground, healthy again for 20s: never up.
  s = run(s, [30, 30, 30, 30, 12, 30, 30, 30, 30]);
  expect(s.tier).toBe(160);
});

test('the middle ground holds the tier', () => {
  let s = { tier: 160, healthySince: null, lastStepAt: 0 };
  s = run(s, [10, 15, 20, 10, 18, 24, 8]);
  expect(s.tier).toBe(160);
});
