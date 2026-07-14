import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Appearance } from 'react-native';
import { themes, defaultTheme } from './tokens';
import { storage } from '../storage/mmkv';

// Same persistence key as the web app ('aura.theme'). Native adds one value
// the web doesn't have: 'auto' follows the system light/dark setting live
// (light → dusk, dark → midnight); `name` is always the resolved theme, so
// consumers never see 'auto'.
const KEY = 'aura.theme';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [pref, setPref] = useState(() => {
    const v = storage.getItem(KEY);
    return v === 'auto' || themes[v] ? v : defaultTheme;
  });
  const [sysDark, setSysDark] = useState(
    () => Appearance.getColorScheme() === 'dark',
  );

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) =>
      setSysDark(colorScheme === 'dark'),
    );
    return () => sub.remove();
  }, []);

  const name = pref === 'auto' ? (sysDark ? 'midnight' : 'dusk') : pref;

  const value = useMemo(
    () => ({
      name,
      pref,
      t: themes[name],
      setTheme: next => {
        if (next !== 'auto' && !themes[next]) {
          return;
        }
        storage.setItem(KEY, next);
        setPref(next);
      },
    }),
    [name, pref],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
