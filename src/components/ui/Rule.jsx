import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

// One horizontal divider for the whole app.
//
// The line between things was being drawn four different ways: a 1dp `View`
// with `backgroundColor: t.line` (the sheet and popup menus), a container's
// `borderTopWidth: 1` with `borderTopColor: t.line` (the why sheet, talk's
// composer, the journal's entries), and — once — `StyleSheet.hairlineWidth`,
// which on a 3x screen is a third of the others and read visibly fainter than
// every line beside it.
//
// THICKNESS IS 1dp, NOT hairlineWidth. hairlineWidth is the device-correct
// answer, but eight of the nine dividers in the app were already 1dp: picking
// 1 leaves those eight rendering exactly as they did and moves only the single
// hairline outlier (the admin composer's send bar), which gets very slightly
// thicker. Picking hairlineWidth would have thinned eight lines to fix one.
export const RULE_WIDTH = 1;

// The divider as its own element, for the menus that render a line between two
// groups of rows. Margins stay the caller's — the sheets space theirs
// `marginVertical: 6`, the playlists popup only `marginBottom: 6` — so they
// come in through `style` rather than being flattened into one spacing here.
//
// Containers that draw their divider as their own top border keep doing that
// (moving the line out to a sibling would put it inside the container's
// padding, or on the far side of the parent's gap) — they take RULE_WIDTH for
// `borderTopWidth` instead, so there is still only one thickness in the app.
export function Rule({ style }) {
  const { t } = useTheme();
  return <View style={[styles.rule, { backgroundColor: t.line }, style]} />;
}

const styles = StyleSheet.create({
  rule: { height: RULE_WIDTH },
});
