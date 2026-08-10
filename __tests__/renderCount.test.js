import {
  countRender,
  dumpRenderCounts,
  readRenderCounts,
  resetRenderCounts,
} from '../src/lib/renderCount';

// The probe is the one thing in this batch with real behaviour, so unlike the
// contract locks around it these are ordinary assertions.
//
// What matters about it: it must count honestly, it must not accumulate across
// windows (a tally that never resets makes the second measurement meaningless),
// and it must not itself be expensive on the path it is measuring.

// The console spy lives here rather than inside each test on purpose. Doing it
// per-test cost me a false failure first: jest.spyOn on an already-spied method
// hands back the SAME mock, so a test that forgot to restore leaked its
// recorded calls into the next one — and the next one was asserting that
// nothing had been logged.
let log;
beforeEach(() => {
  jest.useFakeTimers();
  resetRenderCounts();
  log = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  log.mockRestore();
  resetRenderCounts();
  jest.useRealTimers();
});

describe('it counts what it is told', () => {
  test('tallies per tag', () => {
    countRender('Row');
    countRender('Row');
    countRender('Screen');
    expect(readRenderCounts()).toEqual({ Row: 2, Screen: 1 });
  });

  test('reading does not disturb the tally', () => {
    countRender('Row');
    readRenderCounts();
    readRenderCounts();
    expect(readRenderCounts()).toEqual({ Row: 1 });
  });

  test('the snapshot is a copy, not the live map', () => {
    countRender('Row');
    const snap = readRenderCounts();
    countRender('Row');
    expect(snap).toEqual({ Row: 1 });
  });
});

describe('a window closes itself and starts clean', () => {
  test('the tally is dumped and reset when the window expires', () => {
    countRender('Row');
    countRender('Row');

    expect(readRenderCounts()).toEqual({ Row: 2 });
    jest.advanceTimersByTime(2500);

    expect(log).toHaveBeenCalledWith('[renders] Row=2');
    // The reset is the point. Without it the second measurement — the whole
    // reason this exists — would include the first.
    expect(readRenderCounts()).toEqual({});
  });

  test('a later count opens a fresh window rather than reviving the old one', () => {
    countRender('Row');
    jest.advanceTimersByTime(2500);
    log.mockClear();

    countRender('Row');
    countRender('Row');
    countRender('Row');
    jest.advanceTimersByTime(2500);

    expect(log).toHaveBeenCalledWith('[renders] Row=3');
  });

  test('the window is armed once, not re-armed per count', () => {
    // Not a style preference: re-arming would mean a clearTimeout +
    // setTimeout on EVERY render of every mounted row — instrumentation
    // heavy enough to change what it is measuring. So the window must expire
    // 2500ms after the FIRST count, no matter how many follow.
    countRender('Row');
    jest.advanceTimersByTime(2000);
    countRender('Row'); // would push the deadline out if it re-armed
    jest.advanceTimersByTime(600);

    expect(log).toHaveBeenCalledWith('[renders] Row=2');
  });
});

describe('the dump reads for a human', () => {
  test('biggest tag first, so the runaway one does not need hunting', () => {
    countRender('Screen');
    for (let i = 0; i < 40; i++) {
      countRender('Row');
    }
    countRender('Other');
    countRender('Other');

    dumpRenderCounts('liked · one fling');

    expect(log).toHaveBeenCalledWith(
      '[renders] liked · one fling Row=40 Other=2 Screen=1',
    );
  });

  test('says so rather than printing an empty line when nothing ran', () => {
    dumpRenderCounts('idle');
    expect(log).toHaveBeenCalledWith('[renders] idle nothing counted');
  });

  test('dumping returns the snapshot it printed', () => {
    countRender('Row');
    expect(dumpRenderCounts()).toEqual({ Row: 1 });
    expect(readRenderCounts()).toEqual({});
  });
});

describe('it leaves nothing running', () => {
  test('resetting cancels a pending window', () => {
    countRender('Row');
    resetRenderCounts();
    jest.advanceTimersByTime(5000);
    // A timer surviving a reset would print a stray line into the middle of
    // the next measurement.
    expect(log).not.toHaveBeenCalled();
  });
});
