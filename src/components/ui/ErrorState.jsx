import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { fonts, label } from '../../theme/tokens';

// The house failure block: the line that says what broke, plus the way out.
//
// Twelve screens used to render a failure as one line of grey text and nothing
// else — the only move left was Back, which throws the screen away rather than
// retrying it. The handful of screens that DID offer a retry each hand-rolled
// one, so "try again" looked like three different things.
//
// The treatment is History's, unchanged: its load-more pill, reused for the
// first-page failure so both reads as one design. The pill is 33dp tall, so it
// carries hitSlop 8 to clear the 48dp touch floor the app's two target passes
// set. Copy stays the caller's — this adds the action, it doesn't rewrite the
// sentence.
//
// `onRetry` absent (nothing to re-run, or a failure the user can't fix) renders
// the line alone, which is exactly what these screens did before.

// label() builds a new style object per call — hoisted, like DetailChassis
// hoists its row styles.
const RETRY_LABEL = label(10);

export function ErrorState({
  message,
  onRetry,
  retryLabel = 'Try again',
  style,
}) {
  const { t } = useTheme();
  return (
    <View style={[styles.wrap, style]}>
      <Text style={[styles.line, { color: t.inkSoft }]}>{message}</Text>
      {!!onRetry && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={retryLabel.toLowerCase()}
          onPress={onRetry}
          hitSlop={8}
          style={({ pressed }) => [
            styles.retry,
            { borderColor: t.line },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[RETRY_LABEL, { color: t.inkSoft }]}>{retryLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  line: { fontFamily: fonts.regular, fontSize: 13.5 },
  retry: {
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 10,
    marginTop: 18,
  },
  pressed: { opacity: 0.6 },
});
