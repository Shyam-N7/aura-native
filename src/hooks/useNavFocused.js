import { useContext, useEffect, useState } from 'react';
import { NavigationContext } from '@react-navigation/native';

// Whether the owning screen is the focused one. Context read instead of
// useIsFocused: outside a navigator (tests, overlays, standalone renders)
// there is no screen to be blurred by, so focused defaults true. Tabs and the
// native stack both keep parked screens MOUNTED — an infinite loop gated only
// on mount keeps ticking invisibly behind the active screen, and every tick
// forces the glass views to re-capture the whole tree (the reports/10 class).
export function useNavFocused() {
  const navigation = useContext(NavigationContext);
  const [focused, setFocused] = useState(
    () => navigation?.isFocused?.() ?? true,
  );
  useEffect(() => {
    if (!navigation) {
      return undefined;
    }
    const onFocus = navigation.addListener('focus', () => setFocused(true));
    const onBlur = navigation.addListener('blur', () => setFocused(false));
    return () => {
      onFocus();
      onBlur();
    };
  }, [navigation]);
  return focused;
}
