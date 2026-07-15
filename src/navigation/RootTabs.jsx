import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Dock } from '../components/nav/Dock';

const Tabs = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const renderDock = props => <Dock {...props} />;

// getComponent (not component) keeps screen modules unloaded until first
// focus, so feature agents can rewrite them without touching this file.
function TabsNavigator() {
  return (
    <Tabs.Navigator screenOptions={{ headerShown: false }} tabBar={renderDock}>
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
    </Stack.Navigator>
  );
}
