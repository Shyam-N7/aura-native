// Open bus for the sleep-timer picker sheet (web lib/sleepTimerSheet.js).
const subscribers = new Set();

export function openSleepTimer() {
  subscribers.forEach(fn => fn(true));
}

export function subscribeSleepTimerSheet(fn) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
