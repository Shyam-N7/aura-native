import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { QUALITIES } from '../lib/audioQuality';
import { closeQualitySheet, subscribeQualitySheet } from '../lib/qualitySheet';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/ui/Sheet';
import { fonts, label } from '../theme/tokens';

// The audio-quality picker — a popover for the player's quality pill. Setting
// goes through player.setQuality so the engine re-fetches the current stream at
// the new bitrate (not the audioQuality store directly, which only the next
// track would pick up).
export function QualitySheet() {
  const { t } = useTheme();
  const player = usePlayer();
  const [open, setOpen] = useState(false);

  useEffect(() => subscribeQualitySheet(setOpen), []);

  if (!open) {
    return null;
  }

  const active = player.quality;
  const pick = id => {
    if (id !== active) {
      player.setQuality(id);
    }
    closeQualitySheet();
  };

  return (
    <Sheet onClose={closeQualitySheet} closeLabel="close quality">
      <Text style={[styles.title, { color: t.ink }]}>audio quality</Text>
      <Text style={[label(9.5), styles.sub, { color: t.inkFaint }]}>
        higher sounds better · lower saves data
      </Text>
      {QUALITIES.map(q => {
        const on = q.id === active;
        return (
          <Pressable
            key={q.id}
            accessibilityRole="button"
            accessibilityLabel={`quality ${q.label}`}
            accessibilityState={{ selected: on }}
            onPress={() => pick(q.id)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.rowMeta}>
              <Text style={[styles.rowLabel, { color: on ? t.accent : t.ink }]}>
                {q.label}
              </Text>
              <Text style={[styles.rowHint, { color: t.inkSoft }]}>
                {q.caption}
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
