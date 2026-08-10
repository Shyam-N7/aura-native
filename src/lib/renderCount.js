// Did the memo work? — a render tally for the long lists.
//
// Six commits have now gone in against one diagnosis: that these screens hand
// their rows props whose IDENTITY changes every render, so React.memo bails out
// of bailing out and every mounted row re-renders. Nothing has measured it.
// Jest cannot: it sees renders but not the device, and every one of those
// changes is behaviour-preserving, so a green suite only says nothing broke.
//
// Frame time is the symptom, but it is the wrong instrument here — it is
// confounded by artwork decode, network, thermal state and whatever else the
// phone is doing, and a debug build's numbers do not transfer to release. It
// would produce a number that cannot attribute anything to anything.
//
// Render counts are the honest instrument, because "this prop stopped changing
// identity, so these rows stopped re-rendering" IS the claim. It is
// deterministic, it is directly attributable, and it can kill the diagnosis
// rather than decorate it.
//
// __DEV__-only by construction, exactly as lib/queueDrift.js is and for the
// same reason stated there: Metro strips an `if (__DEV__)` branch out of the
// release bundle, so shipping users carry none of this — no map, no counting,
// no allocation. Debug builds emit console to logcat and release builds do not,
// so `adb logcat -s ReactNativeJS` is the readout.
//
//   adb logcat -c && adb logcat -s ReactNativeJS | grep renders
//
// Reading it: scroll the surface, then dump. What matters is not the absolute
// number — it is the SAME number measured twice, once with the memo call sites
// in place and once with them reverted on the same build. If the rows do not
// drop materially, the diagnosis is wrong and the cost is somewhere else.

const counts = Object.create(null);

// The window a dump covers. Long enough to hold a whole fling and its momentum,
// short enough that two scrolls do not blur into one line.
const WINDOW_MS = 2500;
let windowTimer = null;

// Called from a component body, so it must stay as close to free as a function
// call gets — and it must vanish entirely in release. No timestamps, no arrays,
// no string building; one property bump.
//
// The window is armed by the FIRST count and then left alone — deliberately not
// reset on every call, which would be a clearTimeout + setTimeout per render on
// the exact path being measured. Instrumentation that changes what it measures
// is worse than none.
export function countRender(tag) {
  if (!__DEV__) {
    return;
  }
  counts[tag] = (counts[tag] ?? 0) + 1;
  if (windowTimer === null) {
    windowTimer = setTimeout(() => {
      windowTimer = null;
      dumpRenderCounts();
    }, WINDOW_MS);
  }
}

// Snapshot without disturbing the tally — for tests, and for anything that
// wants to diff two moments rather than reset between them.
export function readRenderCounts() {
  return { ...counts };
}

export function resetRenderCounts() {
  for (const tag of Object.keys(counts)) {
    delete counts[tag];
  }
  clearTimeout(windowTimer);
  windowTimer = null;
}

// One greppable line, biggest first, then reset — the same shape as
// `[drift]`, so one logcat filter reads both. Sorted because on a long list the
// interesting tag is whichever one ran away, and that should not need scanning
// for.
export function dumpRenderCounts(label = '') {
  if (!__DEV__) {
    return null;
  }
  const snapshot = { ...counts };
  const entries = Object.entries(snapshot).sort((a, b) => b[1] - a[1]);
  const body = entries.length
    ? entries.map(([tag, n]) => `${tag}=${n}`).join(' ')
    : 'nothing counted';
  console.log(`[renders]${label ? ` ${label}` : ''} ${body}`);
  resetRenderCounts();
  return snapshot;
}
