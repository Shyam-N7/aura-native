import { cappedBoostMb, curveAt, resample, PRESETS } from '../src/lib/equalizer';

// The device's own bands (read off the phone by the phase-0 probe: 5 bands,
// ±15 dB). The web equalizer has 8 fixed bands at different frequencies, so
// every preset has to be resampled onto these — that mapping is what these
// tests pin down.
const DEVICE = [
  { index: 0, centerHz: 60, minMb: -1500, maxMb: 1500 },
  { index: 1, centerHz: 230, minMb: -1500, maxMb: 1500 },
  { index: 2, centerHz: 910, minMb: -1500, maxMb: 1500 },
  { index: 3, centerHz: 3600, minMb: -1500, maxMb: 1500 },
  { index: 4, centerHz: 14000, minMb: -1500, maxMb: 1500 },
];

const gainsOf = id => PRESETS.find(p => p.id === id).gains;

describe('curveAt — reading a web curve at any frequency', () => {
  it('returns the anchor value exactly at a web band', () => {
    const loud = gainsOf('loud'); // [60,150,400,1k,2.4k,6k,12k,16k]
    expect(curveAt(loud, 60)).toBeCloseTo(4, 5);
    expect(curveAt(loud, 1000)).toBeCloseTo(1, 5);
    expect(curveAt(loud, 16000)).toBeCloseTo(4, 5);
  });

  it('holds the nearest anchor outside the web range', () => {
    const warm = gainsOf('warm');
    expect(curveAt(warm, 20)).toBeCloseTo(warm[0], 5);
    expect(curveAt(warm, 22000)).toBeCloseTo(warm[7], 5);
  });

  it('interpolates on a LOG scale, not a linear one', () => {
    // Between 400 Hz (1.0) and 1 kHz (2.5) in the clarity curve, the
    // geometric midpoint (632 Hz) must land halfway. Linear interpolation
    // would put the halfway point at 700 Hz and read ~1.9 here instead.
    const clarity = gainsOf('clarity');
    const geoMid = Math.sqrt(400 * 1000);
    expect(curveAt(clarity, geoMid)).toBeCloseTo(1.75, 2);
  });
});

describe('resample — a web preset onto the device bands', () => {
  it('produces one millibel value per device band', () => {
    const out = resample(gainsOf('loud'), DEVICE);
    expect(out).toHaveLength(DEVICE.length);
    out.forEach(v => expect(Number.isInteger(v)).toBe(true));
  });

  it('reads the source curve AT each device frequency', () => {
    const loud = gainsOf('loud');
    const out = resample(loud, DEVICE);
    // 60 Hz is a shared anchor: +4 dB → 400 mB.
    expect(out[0]).toBe(400);
    // 14 kHz sits between the web's 12k (+3) and 16k (+4).
    expect(out[4]).toBe(Math.round(curveAt(loud, 14000) * 100));
  });

  it('keeps flat flat', () => {
    expect(resample(gainsOf('flat'), DEVICE)).toEqual([0, 0, 0, 0, 0]);
  });

  it('preserves each preset’s SHAPE rather than any single ordering', () => {
    // 'loud' is a smile — the extremes sit above the middle. (Deliberately not
    // a monotonicity check: these curves are not monotonic by design.)
    const out = resample(gainsOf('loud'), DEVICE);
    expect(out[0]).toBeGreaterThan(out[2]);
    expect(out[4]).toBeGreaterThan(out[2]);
    // 'warm' rolls off the top: bass above treble.
    const warm = resample(gainsOf('warm'), DEVICE);
    expect(warm[0]).toBeGreaterThan(warm[4]);
  });

  it('clamps to what the hardware accepts', () => {
    const tight = DEVICE.map(b => ({ ...b, minMb: -200, maxMb: 200 }));
    const out = resample(gainsOf('loud'), tight);
    out.forEach(v => {
      expect(v).toBeLessThanOrEqual(200);
      expect(v).toBeGreaterThanOrEqual(-200);
    });
  });

  it('handles a device with a different band layout', () => {
    // The whole point of resampling: a 3-band phone must still work.
    const three = [
      { index: 0, centerHz: 100, minMb: -1200, maxMb: 1200 },
      { index: 1, centerHz: 1000, minMb: -1200, maxMb: 1200 },
      { index: 2, centerHz: 10000, minMb: -1200, maxMb: 1200 },
    ];
    const out = resample(gainsOf('clarity'), three);
    expect(out).toHaveLength(3);
    // clarity lifts the 1k presence band and leaves the extremes alone.
    expect(out[1]).toBeGreaterThan(out[0]);
  });
});

describe('cappedBoostMb — boost + EQ must never stack past the limiter', () => {
  it('passes boost through when the curve is flat', () => {
    expect(cappedBoostMb(1200, [0, 0, 0, 0, 0], 'limiter')).toBe(1200);
  });

  it('pulls boost down by the hottest positive band', () => {
    // +4 dB hottest band → only +8 dB of boost fits under the +12 ceiling.
    expect(cappedBoostMb(1200, [400, -300, 0, 200, 0], 'limiter')).toBe(800);
  });

  it('ignores cuts — negative bands add no energy', () => {
    expect(cappedBoostMb(600, [-1500, -200, 0, 0, 0], 'limiter')).toBe(600);
  });

  it('caps the plain fallback at +6 dB outright', () => {
    expect(cappedBoostMb(1200, [0, 0, 0, 0, 0], 'plain')).toBe(600);
    expect(cappedBoostMb(600, [300, 0, 0, 0, 0], 'plain')).toBe(300);
  });

  it('never goes negative even when the curve alone exceeds the ceiling', () => {
    expect(cappedBoostMb(300, [1500, 0, 0, 0, 0], 'limiter')).toBe(0);
  });
});

// ── user-saved presets ───────────────────────────────────────────────────
import {
  MAX_NAME,
  deleteEqUserPreset,
  getEqUserPresets,
  saveEqUserPreset,
} from '../src/lib/eqPresets';
import { storage } from '../src/storage/mmkv';

describe('eqPresets — your own saved curves', () => {
  beforeEach(() => storage.removeItem('aura.eq.userPresets'));

  it('saves a curve and reads it back', () => {
    saveEqUserPreset('my bass', [500, -300, 0, 400, 200]);
    const list = getEqUserPresets();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('my bass');
    expect(list[0].gains).toEqual([500, -300, 0, 400, 200]);
  });

  it('refuses blanks and case-insensitive duplicates', () => {
    saveEqUserPreset('Night', [0, 0, 0, 0, 0]);
    expect(saveEqUserPreset('   ', [0, 0, 0, 0, 0])).toBeNull();
    expect(saveEqUserPreset('night', [1, 1, 1, 1, 1])).toBeNull();
    expect(getEqUserPresets()).toHaveLength(1);
  });

  it('trims names to the cap', () => {
    saveEqUserPreset('x'.repeat(80), [0, 0, 0, 0, 0]);
    expect(getEqUserPresets()[0].name).toHaveLength(MAX_NAME);
  });

  it('hides curves that do not fit the device band count', () => {
    saveEqUserPreset('five', [0, 0, 0, 0, 0]);
    saveEqUserPreset('three', [0, 0, 0]);
    // A curve saved for other hardware must never be applied to these bands.
    expect(getEqUserPresets(5).map(p => p.name)).toEqual(['five']);
    expect(getEqUserPresets(3).map(p => p.name)).toEqual(['three']);
  });

  it('deletes by id and survives a corrupt store', () => {
    saveEqUserPreset('gone', [0, 0, 0, 0, 0]);
    deleteEqUserPreset(getEqUserPresets()[0].id);
    expect(getEqUserPresets()).toEqual([]);
    storage.setItem('aura.eq.userPresets', '{not json');
    expect(getEqUserPresets()).toEqual([]);
  });
});
