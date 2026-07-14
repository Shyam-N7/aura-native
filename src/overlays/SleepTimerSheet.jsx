import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import {
  startSleepTimer,
  cancelSleepTimer,
  getSleepState,
  subscribeSleep,
} from '../lib/sleepTimer';
import { subscribeSleepTimerSheet } from '../lib/sleepTimerSheet';
import { showToast } from '../lib/toast';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/ui/Sheet';
import { fonts, label } from '../theme/tokens';
import { fmtTime } from '../utils/fmtTime';

// Sleep-timer picker, ported from web SleepTimerSheet: presets + end of set
// + cancel while armed, with a live countdown. Math.ceil keeps the countdown
// from showing 0:00 before the timer actually fires.
const PRESETS = [10, 20, 30, 45, 60];

export function SleepTimerSheet() {
  const { t } = useTheme();
  const [open, setOpen] = useState(false);
  const [sleep, setSleep] = useState(getSleepState);

  useEffect(() => subscribeSleepTimerSheet(setOpen), []);
  useEffect(() => subscribeSleep(setSleep), []);

  if (!open) {
    return null;
  }

  const close = () => setOpen(false);
  const arm = minutes => {
    startSleepTimer(minutes * 60_000);
    showToast(`sleep in ${minutes} min.`);
    close();
  };
  const armEndOfSet = () => {
    startSleepTimer('end-of-set');
    showToast('sleep at end of set.');
    close();
  };
  const disarm = () => {
    cancelSleepTimer();
    showToast('sleep timer cancelled.');
    close();
  };

  const countdown =
    sleep?.mode === 'duration'
      ? fmtTime(Math.ceil(sleep.remainingMs / 1000))
      : sleep?.mode === 'end-of-set'
      ? 'end of set'
      : null;

  return (
    <Sheet onClose={close} closeLabel="close sleep timer">
      <View style={styles.head}>
        <Icon name="moon" size={19} color={t.accent} />
        <Text style={[styles.title, { color: t.ink }]}>sleep timer</Text>
      </View>
      {!!countdown && (
        <Text style={[label(10), styles.countdown, { color: t.accent }]}>
          sleeping · {countdown}
        </Text>
      )}

      {PRESETS.map(m => (
        <Pressable
          key={m}
          accessibilityRole="button"
          accessibilityLabel={`sleep in ${m} minutes`}
          onPress={() => arm(m)}
          style={({ pressed }) => [styles.item, pressed && styles.pressed]}
        >
          <Text style={[styles.itemLabel, { color: t.ink }]}>{m} min</Text>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="sleep at end of set"
        onPress={armEndOfSet}
        style={({ pressed }) => [styles.item, pressed && styles.pressed]}
      >
        <Text style={[styles.itemLabel, { color: t.ink }]}>end of set</Text>
      </Pressable>
      {!!sleep && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="cancel timer"
          onPress={disarm}
          style={({ pressed }) => [styles.item, pressed && styles.pressed]}
        >
          <Text style={[styles.itemLabel, { color: t.accent }]}>
            cancel timer
          </Text>
        </Pressable>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontFamily: fonts.semibold, fontSize: 18 },
  countdown: { marginTop: 6 },
  item: { paddingVertical: 12 },
  pressed: { opacity: 0.6 },
  itemLabel: { fontFamily: fonts.medium, fontSize: 15 },
});
