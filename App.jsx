import React, { useCallback, useEffect, useState } from 'react';
import { Linking, StatusBar, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  NavigationContainer,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { PlayerProvider } from './src/playback/PlayerContext';
import { acceptPlaylistInvite } from './src/api/playlists';
import { showToast } from './src/lib/toast';
import { PlayerSheet } from './src/overlays/PlayerSheet';
import { LyricsOverlay } from './src/overlays/LyricsOverlay';
import { QueueSheet } from './src/overlays/QueueSheet';
import { TrackActionsSheet } from './src/overlays/TrackActionsSheet';
import { AddToPlaylistSheet } from './src/overlays/AddToPlaylistSheet';
import { SleepTimerSheet } from './src/overlays/SleepTimerSheet';
import { WhySheet } from './src/overlays/WhySheet';
import { PresenceBanners } from './src/overlays/PresenceBanners';
import { Toast } from './src/components/Toast';
import RootTabs from './src/navigation/RootTabs';
import AuthScreen from './src/screens/AuthScreen';
import { getUser, subscribeAuth } from './src/lib/auth';

// Share links the app answers (web parity): /playlists?join=TOKEN joins a
// playlist invite, /p/PUBLIC_ID opens a public playlist read-only. Tokens are
// remembered per session so a re-fired intent can't double-accept.
const handledTokens = new Set();

function Shell() {
  const { name, t } = useTheme();
  const [user, setUser] = useState(getUser);
  const navRef = useNavigationContainerRef();
  useEffect(() => subscribeAuth(() => setUser(getUser())), []);

  const handleLink = useCallback(
    url => {
      if (!url || !getUser() || !navRef.isReady()) {
        return;
      }
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        return;
      }
      const join = parsed.searchParams.get('join');
      if (join && !handledTokens.has(join)) {
        handledTokens.add(join);
        acceptPlaylistInvite(join)
          .then(({ playlistId, name: plName, inviterName }) => {
            const which = plName ? `"${plName}"` : 'the playlist';
            showToast(
              inviterName
                ? `Joined ${which} — shared by ${inviterName}.`
                : `Joined ${which}.`,
            );
            navRef.navigate('Playlist', { id: playlistId });
          })
          .catch(err => showToast(err.message));
        return;
      }
      if (parsed.pathname.startsWith('/p/')) {
        const publicId = parsed.pathname.slice(3).split('/')[0];
        if (publicId) {
          navRef.navigate('Playlist', { publicId });
        }
      }
    },
    [navRef],
  );

  useEffect(() => {
    const sub = Linking.addEventListener('url', e => handleLink(e.url));
    return () => sub.remove();
  }, [handleLink]);

  return (
    <>
      <StatusBar
        barStyle={name === 'midnight' ? 'light-content' : 'dark-content'}
        backgroundColor={t.bg}
      />
      {user ? (
        <NavigationContainer
          ref={navRef}
          onReady={() => Linking.getInitialURL().then(handleLink)}
        >
          <RootTabs />
          <PlayerSheet />
          {/* Lyrics ride above the player; closing them lands back there. */}
          <LyricsOverlay />
          {/* The queue rides above the player; closing it lands back there. */}
          <QueueSheet />
          {/* Action sheets stack above both (JSX order = z-order). */}
          <TrackActionsSheet />
          <AddToPlaylistSheet />
          <SleepTimerSheet />
          <WhySheet />
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
