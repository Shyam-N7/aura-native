import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { ConfirmPopup } from '../src/components/ui/ConfirmPopup';
import { SHEET_DANGER } from '../src/components/ui/SheetRow';

// The app has two confirm dialogs — a sheet and a centered popup — that
// started byte-identical and drifted. Only the sheet ever honoured `danger`,
// so the equalizer's DELETE PRESET confirm rendered its action pill in the
// ordinary accent, indistinguishable from the "Turn on" and "boost it" asks
// sitting beside it in the same panel. Red on a destructive action is the one
// visual cue this app uses for the difference.

async function render(node) {
  let tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
}

// The action pill's own backgroundColor, from the style array Pressable
// resolves for the un-pressed state.
function actionColor(tree, action) {
  const pressable = tree.root.findAllByProps({ accessibilityLabel: action })[0];
  const style = pressable.props.style;
  const flat = (typeof style === 'function' ? style({ pressed: false }) : style)
    .flat()
    .filter(Boolean);
  return flat.find(s => s?.backgroundColor)?.backgroundColor;
}

test('a destructive popup wears the danger colour', async () => {
  const tree = await render(
    <ConfirmPopup
      visible
      title='delete "night"?'
      action="Delete"
      danger
      onConfirm={() => {}}
      onCancel={() => {}}
    />,
  );

  expect(actionColor(tree, 'Delete')).toBe(SHEET_DANGER);
  await ReactTestRenderer.act(() => tree.unmount());
});

test('an ordinary popup does not — it must stay the accent', async () => {
  const tree = await render(
    <ConfirmPopup
      visible
      title="Turn on the equalizer?"
      action="Turn on"
      onConfirm={() => {}}
      onCancel={() => {}}
    />,
  );

  const color = actionColor(tree, 'Turn on');
  expect(color).toBeDefined();
  expect(color).not.toBe(SHEET_DANGER);
  await ReactTestRenderer.act(() => tree.unmount());
});

// The point isn't that the prop exists, it's that the one destructive call
// site passes it. That call site is the reason the prop was added.
test('the equalizer delete confirm is marked destructive', () => {
  const fs = require('fs');
  const path = require('path');
  const body = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'audio', 'EqualizerPanel.jsx'),
    'utf8',
  );

  const deleteBlock = body.slice(body.indexOf('action="Delete"'));
  expect(deleteBlock.slice(0, 60)).toContain('danger');
});
