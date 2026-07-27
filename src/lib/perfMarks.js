import * as Sentry from '@sentry/react-native';
import { crumb } from './crumbs';

// Cold-open stage timing (docs/perf/01 §6). mark() stamps milliseconds since
// JS start at each boot stage; ~6s after launch the whole table ships as one
// info event ("cold-open-timing"), so baselines come from real phones in the
// field — release builds swallow console and adb can't read app storage, so
// Sentry is the one channel that works everywhere. Each mark is also a
// breadcrumb, so crashes carry the boot timeline for free.
//
// Cost control: one small event per cold start, nothing per-frame, and the
// table caps at 32 entries. Dial SAMPLE down once baselines are collected.

const t0 = Date.now();
const stages = {};
let shipped = false;
const SAMPLE = 1.0;

export function mark(name) {
  if (shipped || stages[name] != null || Object.keys(stages).length >= 32) {
    return;
  }
  const ms = Date.now() - t0;
  stages[name] = ms;
  crumb('perf', name, { ms });
}

// Called once from index.js after registration; waits out the boot so late
// stages (first-ready on a slow network) still make the table.
export function shipBootTiming() {
  setTimeout(() => {
    shipped = true;
    try {
      Sentry.setContext('boot-timing', stages);
      if (Math.random() < SAMPLE) {
        Sentry.captureMessage('cold-open-timing', 'info');
      }
    } catch {
      // telemetry must never throw into the app
    }
  }, 6000);
}
