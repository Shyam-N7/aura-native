/**
 * @format
 */

import { AppRegistry } from 'react-native';
import TrackPlayer from 'react-native-track-player';
import App from './App';
import { name as appName } from './app.json';

// The playback service must be registered before the app component so RNTP
// can run the queue while the UI is backgrounded.
TrackPlayer.registerPlaybackService(() => require('./src/playback/service'));

AppRegistry.registerComponent(appName, () => App);
