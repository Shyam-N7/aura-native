// What the app tells us about itself, pinned.
//
// These are real assertions, not source reads: index.js is imported with its
// side effects mocked out and the actual Sentry.init argument is inspected.
//
// The reason this file exists: `tracesSampleRate: 0` sat in index.js under a
// comment saying "tracing off until the perf work needs it". It did not turn
// tracing off. The RN SDK registers its performance integrations when
// `typeof tracesSampleRate === 'number'`, and 0 is a number — so app-start,
// native-frames, stall and RN tracing integrations were all constructed and
// running on every device, and every transaction was discarded client-side.
// The app paid for the measurement and shipped none of it, for as long as that
// line existed. Setting it back to 0 to "turn tracing off" is the obvious
// mistake to repeat, and it is silent.

jest.mock('react-native-track-player', () => ({
  registerPlaybackService: jest.fn(),
}));
jest.mock('../src/lib/push', () => ({ displayPush: jest.fn() }));
jest.mock('../src/lib/perfMarks', () => ({
  mark: jest.fn(),
  shipBootTiming: jest.fn(),
}));
jest.mock('../src/lib/crashLog', () => ({ installCrashLogger: jest.fn() }));
jest.mock('../App', () => () => null);
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  setTag: jest.fn(),
  wrap: c => c,
}));

const Sentry = require('@sentry/react-native');
const { AppRegistry, Platform } = require('react-native');

jest.spyOn(AppRegistry, 'registerComponent').mockImplementation(() => {});
require('../index');

const options = Sentry.init.mock.calls[0][0];

describe('the performance data we already collect actually ships', () => {
  test('Sentry.init ran exactly once, at import', () => {
    expect(Sentry.init).toHaveBeenCalledTimes(1);
  });

  test('tracesSampleRate is a number and is not zero', () => {
    // A number, because that is what registers the integrations at all.
    expect(typeof options.tracesSampleRate).toBe('number');
    // Non-zero, because that is what lets any of it leave the device.
    expect(options.tracesSampleRate).toBeGreaterThan(0);
  });

  test('debug and release are distinguishable', () => {
    // Absent, @sentry/core stamps "production" on everything, so a crash from
    // a laptop and a crash from a real install looked identical.
    expect(options.environment).toBeTruthy();
  });

  test('the API level is tagged', () => {
    // The axis a radius tuned on API 34 broke for eleven days on 26-30.
    expect(Sentry.setTag).toHaveBeenCalledWith(
      'api_level',
      String(Platform.Version),
    );
  });
});

describe('options that do nothing are not carried', () => {
  test('no iOS-only options on an Android-only app', () => {
    // enableAppHangTracking is documented @platform ios and is never read by
    // the Android bridge. It read as ANR coverage and provided none — Android
    // ANRs come from sentry-android's own default integration.
    expect(options).not.toHaveProperty('enableAppHangTracking');
  });
});

describe('the guards that were already right', () => {
  test('sessions stay on, so crash-free rate is measurable', () => {
    expect(options.enableAutoSessionTracking).toBe(true);
  });

  test('breadcrumbs are still scrubbed', () => {
    // Invite tokens ride in URLs; this is the one thing between them and a
    // third-party service.
    expect(typeof options.beforeBreadcrumb).toBe('function');
  });
});
