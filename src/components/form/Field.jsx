import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { fonts } from '../../theme/tokens';

// Labelled text input with an inline error line — the auth form's field unit.
// `labelRight` renders on the label row (e.g. the "forgot?" link).
export function Field({ label, error, labelRight, ...input }) {
  const { t } = useTheme();
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: t.inkSoft }]}>{label}</Text>
        {labelRight}
      </View>
      <TextInput
        placeholderTextColor={t.inkFaint}
        cursorColor={t.accent}
        selectionColor={t.accent}
        style={[
          styles.input,
          { backgroundColor: t.surface, borderColor: t.line, color: t.ink },
        ]}
        {...input}
      />
      {!!error && (
        <Text style={[styles.error, { color: t.accent }]}>{error}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 14 },
  labelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  label: { fontFamily: fonts.medium, fontSize: 13 },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontFamily: fonts.regular,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  error: { fontFamily: fonts.regular, fontSize: 12, marginTop: 6 },
});
