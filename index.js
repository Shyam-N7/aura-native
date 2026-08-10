/**
 * @format
 */

import { AppRegistry, Platform } from 'react-native';
import * as Sentry from '@sentry/react-native';
import TrackPlayer from 'react-native-track-player';
import {
  getMessaging,
  setBackgroundMessageHandler,
} from '@react-native-firebase/messaging';
import App from './App';
import { name as appName } from './app.json';
import { installCrashLogger } from './src/lib/crashLog';
import { scrubBreadcrumb } from './src/lib/scrubBreadcrumb';
import { displayPush } from './src/lib/push';
import { mark, shipBootTiming } from './src/lib/perfMarks';

// First thing, before any app code can throw: persist fatal JS errors so a
// field crash (screen off, away from adb) can be diagnosed on next launch.
installCrashLogger();

// Crash + ANR reporting (docs/perf/01 §3). Init BEFORE the app registers so
// native crash handlers hook early; the local crashLog above still runs — it
// answers "what happened" offline, Sentry answers it fleet-wide. Sessions on,
// so the crash-free-rate budget (>99.5%) is actually measured.
//
// On tracesSampleRate — the comment here used to say "tracing off until the
// perf work needs it", and that was not what the code did. The RN SDK decides
// whether to REGISTER its performance integrations with
//
//   typeof options.tracesSampleRate === 'number'
//   (@sentry/react-native/…/integrations/default.js:64)
//
// and 0 is a number. So appStart, native frames, stall tracking, the RN
// tracing integration and timeToDisplay have all been constructed and running
// on every device this whole time — measuring cold start, slow/frozen frames
// and JS stalls — and then every transaction they produced was thrown away
// client-side at rate 0. We were paying the cost and shipping none of it.
//
// 1.0 while this is sideloaded to a handful of people: the measurement is
// already happening, so the only added cost is sending it, and pre-release is
// exactly when the baselines are worth having. This needs an actual decision
// before any wide release — perfMarks carries a "dial SAMPLE down once
// baselines are collected" note that was never acted on because nobody read
// the baselines, and a second vague TODO would go the same way.
Sentry.init({
  dsn: 'https://0a8ed63b17fdc1dfe0a151c76f1f4f8b@o4511808612270080.ingest.us.sentry.io/4511808667648005',
  enableAutoSessionTracking: true,
  tracesSampleRate: 1.0,
  // Without this every build reports as "production" (@sentry/core's default),
  // so a crash from this laptop and a crash from a real install were
  // indistinguishable in the UI.
  environment: __DEV__ ? 'development' : 'production',
  maxBreadcrumbs: 150,
  beforeBreadcrumb: scrubBreadcrumb,
});

// The Android API level, as a tag.
//
// Sentry's native layer already attaches os.version in the device context and
// that IS queryable — this is not filling a hole so much as widening a door.
// A tag gets its own facet on the issue page and can be used in alert rules
// without writing a search, and after a radius tuned on API 34 made the app
// unlaunchable on 26-30 for eleven days, the API level is the axis worth
// having one click away rather than one query away.
//
// Platform.Version is the API level integer on Android — no new dependency.
Sentry.setTag('api_level', String(Platform.Version));

// The playback service must be registered before the app component so RNTP
// can run the queue while the UI is backgrounded.
TrackPlayer.registerPlaybackService(() => require('./src/playback/service'));

// FCM requires a background handler registered outside React. Notification-
// type pushes are shown by the OS on their own; data-only pushes land HERE and
// the OS draws nothing for them — this used to be an empty function, so a
// broadcast sent as data simply vanished. Post those ourselves. No toast
// fallback: there is no UI to show one to in the background.
setBackgroundMessageHandler(getMessaging(), async msg => {
  if (!msg?.notification) {
    await displayPush(msg, { fallbackToast: false });
  }
});

// Sentry.wrap adds the React error boundary + touch/context enrichment
// around the root — crashes carry what the user was doing, not just a stack.
AppRegistry.registerComponent(appName, () => Sentry.wrap(App));

// Cold-open baseline (docs/perf/01 §6): stamp the entry, then ship the whole
// stage table once the boot settles.
mark('js-entry');
shipBootTiming();
