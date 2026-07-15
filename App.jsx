import React, { useEffect, useState } from 'react';
import { StatusBar, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { PlayerProvider } from './src/playback/PlayerContext';
import { PlayerSheet } from './src/overlays/PlayerSheet';
import { QueueSheet } from './src/overlays/QueueSheet';
import { TrackActionsSheet } from './src/overlays/TrackActionsSheet';
import { AddToPlaylistSheet } from './src/overlays/AddToPlaylistSheet';
import { SleepTimerSheet } from './src/overlays/SleepTimerSheet';
import { PresenceBanners } from './src/overlays/PresenceBanners';
import { Toast } from './src/components/Toast';
import RootTabs from './src/navigation/RootTabs';
import AuthScreen from './src/screens/AuthScreen';
import { getUser, subscribeAuth } from './src/lib/auth';

function Shell() {
  const { name, t } = useTheme();
  const [user, setUser] = useState(getUser);
  useEffect(() => subscribeAuth(() => setUser(getUser())), []);

  return (
    <>
      <StatusBar
        barStyle={name === 'midnight' ? 'light-content' : 'dark-content'}
        backgroundColor={t.bg}
      />
      {user ? (
        <NavigationContainer>
          <RootTabs />
          <PlayerSheet />
          {/* The queue rides above the player; closing it lands back there. */}
          <QueueSheet />
          {/* Action sheets stack above both (JSX order = z-order). */}
          <TrackActionsSheet />
          <AddToPlaylistSheet />
          <SleepTimerSheet />
          {/* Heartbeats + "playing elsewhere" note + cross-device resume. */}
          <PresenceBanners />
        </NavigationContainer>
      ) : (
        <AuthScreen />
      )}
      <Toast />
    </>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ThemeProvider>
          <PlayerProvider>
            <Shell />
          </PlayerProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
