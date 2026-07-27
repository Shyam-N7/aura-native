/**
 * @format
 */

import { AppRegistry } from 'react-native';
import * as Sentry from '@sentry/react-native';
import TrackPlayer from 'react-native-track-player';
import {
  getMessaging,
  setBackgroundMessageHandler,
} from '@react-native-firebase/messaging';
import App from './App';
import { name as appName } from './app.json';
import { installCrashLogger } from './src/lib/crashLog';

// First thing, before any app code can throw: persist fatal JS errors so a
// field crash (screen off, away from adb) can be diagnosed on next launch.
installCrashLogger();

// Crash + ANR reporting (docs/perf/01 §3). Init BEFORE the app registers so
// native crash handlers hook early; the local crashLog above still runs — it
// answers "what happened" offline, Sentry answers it fleet-wide. Sessions on,
// so the crash-free-rate budget (>99.5%) is actually measured. Tracing off
// until the perf work needs it — breadcrumbs are the point right now.
Sentry.init({
  dsn: 'https://0a8ed63b17fdc1dfe0a151c76f1f4f8b@o4511808612270080.ingest.us.sentry.io/4511808667648005',
  enableAppHangTracking: true,
  enableAutoSessionTracking: true,
  tracesSampleRate: 0,
  maxBreadcrumbs: 150,
});

// The playback service must be registered before the app component so RNTP
// can run the queue while the UI is backgrounded.
TrackPlayer.registerPlaybackService(() => require('./src/playback/service'));

// FCM requires a background handler registered outside React. Notification-
// type pushes are shown by the OS on their own; data-only pushes land here
// (nothing to do with them yet — later phases can act on silent pushes).
setBackgroundMessageHandler(getMessaging(), async () => {});

// Sentry.wrap adds the React error boundary + touch/context enrichment
// around the root — crashes carry what the user was doing, not just a stack.
AppRegistry.registerComponent(appName, () => Sentry.wrap(App));
