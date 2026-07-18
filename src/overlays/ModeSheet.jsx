import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { getUser, setActiveMode, subscribeAuth } from '../lib/auth';
import {
  closeModeSheet,
  subscribeModeSheet,
  MODE_HINT,
} from '../lib/modeSheet';
import { showToast } from '../lib/toast';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/ui/Sheet';
import { fonts, label } from '../theme/tokens';

// The listening-mode picker. Modes come from the server (user.modes: each
// { key, label, explicitOff }); switching reseeds the home pool and retags
// events. 'car' is a Phase-5 experience layer (drive-safe UI + leveling), not
// a vibe — hidden here until that lands so it isn't a confusing no-op.
export function ModeSheet() {
  const { t } = useTheme();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState(getUser);

  useEffect(() => subscribeModeSheet(setOpen), []);
  useEffect(() => subscribeAuth(() => setUser(getUser())), []);

  if (!open) {
    return null;
  }

  const active = user?.activeMode ?? 'everyday';
  const modes = (user?.modes ?? []).filter(m => m.key !== 'car');

  // Optimistic: close immediately and let setActiveMode flip the mode locally
  // (Home re-seeds at once) while the network confirms behind it. A failure
  // reverts the flip and toasts — no spinner, no blocking wait.
  const pick = key => {
    closeModeSheet();
    if (key === active) {
      return;
    }
    setActiveMode(key).catch(err => showToast(`couldn't switch — ${err.message}`));
  };

  return (
    <Sheet onClose={closeModeSheet} closeLabel="close modes">
      <Text style={[styles.title, { color: t.ink }]}>listening mode</Text>
      <Text style={[label(9.5), styles.sub, { color: t.inkFaint }]}>
        shapes what home suggests
      </Text>
      {modes.length === 0 && (
        <Text style={[styles.empty, { color: t.inkSoft }]}>
          modes load with your account — try again in a moment.
        </Text>
      )}
      {modes.map(m => {
        const on = m.key === active;
        return (
          <Pressable
            key={m.key}
            accessibilityRole="button"
            accessibilityLabel={m.key}
            accessibilityState={{ selected: on }}
            onPress={() => pick(m.key)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.rowMeta}>
              <Text
                style={[styles.rowLabel, { color: on ? t.accent : t.ink }]}
              >
                {(m.label ?? m.key).toLowerCase()}
              </Text>
              <Text style={[styles.rowHint, { color: t.inkSoft }]}>
                {MODE_HINT[m.key] ?? (m.explicitOff ? 'clean' : '')}
              </Text>
            </View>
            {on ? <Icon name="check" size={20} color={t.accent} /> : null}
          </Pressable>
        );
      })}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.semibold, fontSize: 18 },
  sub: { marginTop: 3, marginBottom: 8 },
  empty: {
    fontFamily: fonts.regular,
    fontSize: 13.5,
    paddingVertical: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
  },
  pressed: { opacity: 0.6 },
  rowMeta: { flex: 1, gap: 2 },
  rowLabel: { fontFamily: fonts.medium, fontSize: 16 },
  rowHint: { fontFamily: fonts.regular, fontSize: 12.5 },
});
