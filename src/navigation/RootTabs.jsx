import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

const Tabs = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// The dock is NOT this navigator's tabBar: detail screens live on the root
// stack above the tabs, and a tabBar-slot dock vanished on all of them. App
// renders the Dock as an overlay above the whole navigator instead.
const noTabBar = () => null;

// getComponent (not component) keeps screen modules unloaded until first
// focus, so feature agents can rewrite them without touching this file.
function TabsNavigator() {
  return (
    <Tabs.Navigator screenOptions={{ headerShown: false }} tabBar={noTabBar}>
      <Tabs.Screen
        name="Home"
        getComponent={() => require('../screens/HomeScreen').default}
        options={{ tabBarLabel: 'home' }}
      />
      <Tabs.Screen
        name="Search"
        getComponent={() => require('../screens/SearchScreen').default}
        options={{ tabBarLabel: 'search' }}
      />
      <Tabs.Screen
        name="Talk"
        getComponent={() => require('../screens/TalkScreen').default}
        options={{ tabBarLabel: 'talk' }}
      />
      <Tabs.Screen
        name="You"
        getComponent={() => require('../screens/YouScreen').default}
        options={{ tabBarLabel: 'you' }}
      />
    </Tabs.Navigator>
  );
}

// Root stack wraps the tabs for the detail screens. The queue is NOT here:
// it lives as an overlay sheet above the player (overlays/QueueSheet), so
// opening it never closes the player underneath.
export default function RootTabs() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={TabsNavigator} />
      <Stack.Screen
        name="Liked"
        getComponent={() => require('../screens/LikedScreen').default}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="History"
        getComponent={() => require('../screens/HistoryScreen').default}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Artist"
        getComponent={() => require('../screens/ArtistScreen').default}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Album"
        getComponent={() => require('../screens/AlbumScreen').default}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="LanguageHub"
        getComponent={() => require('../screens/LanguageHubScreen').default}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="CatalogPlaylist"
        getComponent={() => require('../screens/CatalogPlaylistScreen').default}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Playlists"
        getComponent={() => require('../screens/PlaylistsScreen').default}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Journal"
        getComponent={() => require('../screens/JournalScreen').default}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Dna"
        getComponent={() => require('../screens/DnaScreen').default}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Bridges"
        getComponent={() => require('../screens/BridgesScreen').default}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Playlist"
        getComponent={() => require('../screens/PlaylistScreen').default}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="AdminCompose"
        getComponent={() => require('../screens/AdminComposeScreen').default}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Equalizer"
        getComponent={() => require('../screens/EqualizerScreen').default}
        options={{ animation: 'slide_from_right' }}
      />
    </Stack.Navigator>
  );
}
