// perfMarks now logs each boot stage to console so .github/scripts/smoke.sh can
// see that JS actually ran — a debug build whose bundle fails shows a redbox
// with a live PID and no FATAL EXCEPTION, so the smoke test had no way to tell
// a working app from a dead one.
//
// The gate is the whole reason that is safe. perfMarks is deliberately LIVE in
// release: it ships the cold-open table to Sentry from 100% of installs. Only
// the console line is __DEV__. Gating the wrong thing — the mark, the crumb, or
// the Sentry event — would silently delete the app's only boot telemetry, and
// nothing else in the suite would notice.

describe('the boot-stage log', () => {
  let log;
  beforeEach(() => {
    jest.resetModules();
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => log.mockRestore());

  test('prints one greppable line per stage in dev', () => {
    const { mark } = require('../src/lib/perfMarks');
    mark('first-render');
    // Shape matters: smoke.sh greps for exactly `[perf] first-render`, and it
    // shares a logcat filter with [drift] and [renders].
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[perf\] first-render \d+ms$/));
  });

  test('says nothing in a release build', () => {
    const wasDev = global.__DEV__;
    global.__DEV__ = false;
    try {
      const { mark } = require('../src/lib/perfMarks');
      mark('first-render');
      expect(log).not.toHaveBeenCalled();
    } finally {
      global.__DEV__ = wasDev;
    }
  });

  test('release still records the stage for Sentry', () => {
    // The half that must NOT be gated. If a future change moves the __DEV__
    // check up a line, this fails and the "says nothing in release" test above
    // would still pass — which is exactly how that mistake ships.
    const wasDev = global.__DEV__;
    global.__DEV__ = false;
    try {
      jest.doMock('../src/lib/crumbs', () => ({ crumb: jest.fn(), report: jest.fn() }));
      const { crumb } = require('../src/lib/crumbs');
      const { mark } = require('../src/lib/perfMarks');
      mark('js-entry');
      expect(crumb).toHaveBeenCalledWith('perf', 'js-entry', expect.any(Object));
    } finally {
      global.__DEV__ = wasDev;
    }
  });
});
