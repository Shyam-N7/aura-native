// Runs AFTER the test framework is installed, so afterEach exists here.
// jest.setup.js is a `setupFiles` entry, which runs BEFORE it — putting this
// there defines nothing and breaks every suite.
//
// The __DEV__ render tally (src/lib/renderCount) arms a 2.5s window the first
// time any component renders, then logs and resets. A suite finishes long
// before that fires, so the timer outlives its test and jest reports "Cannot
// log after tests are done" — and, in bulk, "a worker process has failed to
// exit gracefully".
//
// That is test hygiene, not a defect in the probe: on a device the window is
// exactly what makes it readable. Cleared here rather than gated inside the
// module, so the production path stays free of test awareness.
afterEach(() => {
  try {
    require('./src/lib/renderCount').resetRenderCounts();
  } catch {
    // not every suite loads it
  }
});
