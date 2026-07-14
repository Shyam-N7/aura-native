/**
 * @format
 */

import { AppRegistry } from 'react-native';
import TrackPlayer from 'react-native-track-player';
import App from './App';
import { name as appName } from './app.json';
import { installCrashLogger } from './src/lib/crashLog';

// First thing, before any app code can throw: persist fatal JS errors so a
// field crash (screen off, away from adb) can be diagnosed on next launch.
installCrashLogger();

// The playback service must be registered before the app component so RNTP
// can run the queue while the UI is backgrounded.
TrackPlayer.registerPlaybackService(() => require('./src/playback/service'));

AppRegistry.registerComponent(appName, () => App);
