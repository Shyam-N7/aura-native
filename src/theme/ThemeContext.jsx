import React, { createContext, useContext, useMemo, useState } from 'react';
import { themes, defaultTheme } from './tokens';
import { storage } from '../storage/mmkv';

// Same persistence key as the web app ('aura.theme').
const KEY = 'aura.theme';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [name, setName] = useState(() => {
    const v = storage.getItem(KEY);
    return themes[v] ? v : defaultTheme;
  });

  const value = useMemo(
    () => ({
      name,
      t: themes[name],
      setTheme: next => {
        if (!themes[next]) {
          return;
        }
        storage.setItem(KEY, next);
        setName(next);
      },
    }),
    [name],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
