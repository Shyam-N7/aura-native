import React from 'react';
import { useNavigation, useNavigationState } from '@react-navigation/native';
import { TopBar } from './TopBar';

// The single top bar's home: floated over the TAB navigator (a sibling of
// Tabs.Navigator inside the "Tabs" stack screen), so stack pushes slide the
// bar away with the whole tab layer and detail pages never wear it. One
// instance replaces the four per-tab copies whose hidden clones snapshotted
// the dark window background and arrived black on tab switches.
export function TopBarHost() {
  const navigation = useNavigation();
  // Nearest navigator here is the root STACK; the tabs live inside its
  // first route. Before any tab navigation the nested state is undefined —
  // that's Home, the initial tab.
  const activeTab = useNavigationState(state => {
    const tabs = state?.routes?.[0]?.state;
    return tabs?.routes?.[tabs.index]?.name ?? 'Home';
  });

  const goTab = name => navigation.navigate('Tabs', { screen: name });

  return <TopBar activeTab={activeTab} goTab={goTab} />;
}
