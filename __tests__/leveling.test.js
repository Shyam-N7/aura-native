import {
  DEFAULT_LEVELING,
  LEVELING_MODES,
  gainFor,
  getLeveling,
  setLeveling,
  subscribeLeveling,
} from '../src/lib/leveling';
import { storage } from '../src/storage/mmkv';

beforeEach(() => {
  storage.removeItem('aura.leveling');
});

test('defaults to normal; junk stored values fall back', () => {
  expect(getLeveling()).toBe(DEFAULT_LEVELING);
  storage.setItem('aura.leveling', 'blast');
  expect(getLeveling()).toBe(DEFAULT_LEVELING);
});

test('setLeveling persists valid ids and notifies subscribers', () => {
  const seen = [];
  const unsubscribe = subscribeLeveling(id => seen.push(id));
  setLeveling('quiet');
  expect(getLeveling()).toBe('quiet');
  setLeveling('blast'); // invalid → ignored
  expect(getLeveling()).toBe('quiet');
  unsubscribe();
  expect(seen).toEqual(['quiet']);
});

describe('gainFor — attenuate-only leveling math', () => {
  test('a loud master comes down to the target', () => {
    // -8 LUFS master, -14 target → -6 dB → ~0.5 linear.
    expect(gainFor('normal', { lufs: -8 })).toBeCloseTo(0.5012, 3);
  });

  test('a quiet master plays as mastered — never boosted', () => {
    expect(gainFor('normal', { lufs: -18 })).toBe(1);
  });

  test('off and missing measurements both mean full volume', () => {
    expect(gainFor('off', { lufs: -8 })).toBe(1);
    expect(gainFor('normal', null)).toBe(1);
    expect(gainFor('normal', { lufs: 'x' })).toBe(1);
  });

  test('the tiers order their targets: loud levels least, quiet hardest', () => {
    const target = id => LEVELING_MODES.find(m => m.id === id).target;
    expect(target('loud')).toBeGreaterThan(target('normal'));
    expect(target('normal')).toBeGreaterThan(target('quiet'));
    const track = { lufs: -9 };
    expect(gainFor('loud', track)).toBeGreaterThan(gainFor('normal', track));
    expect(gainFor('normal', track)).toBeGreaterThan(gainFor('quiet', track));
  });
});
