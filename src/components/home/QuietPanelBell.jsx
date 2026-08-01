import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { PressScale } from '../ui/PressScale';
import { Icon } from '../Icon';
import { useTheme } from '../../theme/ThemeContext';
import { subscribePresenceFeed } from '../../lib/presenceFeed';
import { openQuietPanel, subscribeQuietPanel } from '../../lib/quietPanel';
import { getNotifications } from '../../api/notifications';

// The quiet panel's doorway, beside the background-play toggle (owner's
// placement call). The dot is the entire attention mechanism: live presence
// or unseen feed rows light it, opening the panel puts it out — no counts,
// no red.
export function QuietPanelBell() {
  const { t } = useTheme();
  const [live, setLive] = useState(false);
  const [unseen, setUnseen] = useState(false);

  useEffect(
    () => subscribePresenceFeed(f => setLive(!!(f.resume || f.elsewhere))),
    [],
  );
  useEffect(() => {
    getNotifications().then(list => setUnseen(list.some(n => !n.seenAt)));
    // Opening the panel marks everything seen server-side; mirror it here.
    return subscribeQuietPanel(open => {
      if (open) {
        setUnseen(false);
      }
    });
  }, []);

  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel="open notifications"
      onPress={openQuietPanel}
      style={[styles.chip, { borderColor: t.line }]}
    >
      <Icon name="bell" size={16} color={t.inkSoft} />
      {(live || unseen) && (
        <View style={[styles.dot, { backgroundColor: t.accent }]} />
      )}
    </PressScale>
  );
}

const styles = StyleSheet.create({
  // 36 = the 2b rail width, so the bell and the switch read as one column.
  chip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 7,
    height: 7,
    borderRadius: 4,
  },
});
