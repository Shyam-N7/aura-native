import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { fonts, radii } from '../../theme/tokens';

const CELLS = [0, 1, 2, 3, 4, 5];

// Six visible cells backed by one invisible full-size input, so the system
// keyboard and SMS/email autofill treat the code as a single one-time-code
// field while the UI reads as per-digit boxes.
export function CodeInput({ value, onChange, testID }) {
  const { t } = useTheme();
  return (
    <View style={styles.wrap}>
      {CELLS.map(i => (
        <View
          key={i}
          style={[
            styles.cell,
            {
              backgroundColor: t.surface,
              borderColor: i === value.length ? t.accent : t.line,
            },
          ]}>
          <Text style={[styles.char, { color: t.ink }]}>{value[i] ?? ''}</Text>
        </View>
      ))}
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={v => onChange(v.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        caretHidden
        autoFocus
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { columnGap: 8, flexDirection: 'row', marginBottom: 16 },
  cell: {
    alignItems: 'center',
    borderRadius: radii.input,
    borderWidth: 1,
    flex: 1,
    height: 56,
    justifyContent: 'center',
  },
  char: { fontFamily: fonts.semibold, fontSize: 20 },
  // Sits on top of the cells: taps focus it natively, but it stays invisible.
  input: { ...StyleSheet.absoluteFillObject, opacity: 0 },
});
