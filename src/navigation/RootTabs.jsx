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

// Root stack wraps the tabs so Queue opens above them via
// navigation.navigate('Queue') from anywhere (contract 12).
export default function RootTabs() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={TabsNavigator} />
      <Stack.Screen
        name="Queue"
        getComponent={() => require('../screens/QueueScreen').default}
        options={{ animation: 'slide_from_bottom', animationDuration: 360 }}
      />
    </Stack.Navigator>
  );
}
