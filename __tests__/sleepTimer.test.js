import {
  startSleepTimer,
  cancelSleepTimer,
  tickSleepTimer,
  fireEndOfSetIfArmed,
  getSleepState,
  subscribeSleep,
  subscribeSleepFire,
} from '../src/lib/sleepTimer';

jest.useFakeTimers();

afterEach(() => {
  cancelSleepTimer();
  jest.clearAllTimers();
});

test('duration timer counts down and fires once at the deadline', () => {
  const fired = [];
  const unsub = subscribeSleepFire(k => fired.push(k));
  startSleepTimer(10 * 60_000);
  expect(getSleepState()).toMatchObject({ mode: 'duration', totalMs: 600_000 });

  jest.advanceTimersByTime(9 * 60_000);
  expect(fired).toHaveLength(0);
  expect(getSleepState().remainingMs).toBeLessThanOrEqual(60_000);

  jest.advanceTimersByTime(61_000);
  expect(fired).toEqual(['duration']);
  expect(getSleepState()).toBeNull();
  unsub();
});

test('end-of-set fires only while armed, then disarms', () => {
  const fired = [];
  const unsub = subscribeSleepFire(k => fired.push(k));
  expect(fireEndOfSetIfArmed()).toBe(false);

  startSleepTimer('end-of-set');
  expect(getSleepState()).toEqual({ mode: 'end-of-set' });
  expect(fireEndOfSetIfArmed()).toBe(true);
  expect(fired).toEqual(['end-of-set']);
  expect(fireEndOfSetIfArmed()).toBe(false);
  unsub();
});

test('re-arming replaces the timer; cancel disarms and notifies', () => {
  const states = [];
  const unsub = subscribeSleep(s => states.push(s));
  startSleepTimer(10 * 60_000);
  startSleepTimer('end-of-set');
  expect(getSleepState()).toEqual({ mode: 'end-of-set' });
  cancelSleepTimer();
  expect(getSleepState()).toBeNull();
  expect(states[states.length - 1]).toBeNull();
  unsub();
});

test('tickSleepTimer catches a passed deadline (the progress-event path)', () => {
  const fired = [];
  const unsub = subscribeSleepFire(k => fired.push(k));
  startSleepTimer(60_000);
  // Deadline passes without the interval running (screen-off timer stall).
  jest.setSystemTime(Date.now() + 61_000);
  tickSleepTimer();
  expect(fired).toEqual(['duration']);
  unsub();
});
