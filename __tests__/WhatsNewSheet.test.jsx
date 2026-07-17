import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { WhatsNewSheet } from '../src/overlays/WhatsNewSheet';
import { WHATS_NEW_BATCH, shouldShowWhatsNew } from '../src/lib/whatsNew';
import { storage } from '../src/storage/mmkv';

const byLabel = (tree, accessibilityLabel) =>
  tree.root.findAllByProps({ accessibilityLabel })[0];

beforeEach(() => {
  storage.removeItem('aura.whatsNewSeen');
});

test('auto-opens once per batch; got it closes and records seen', async () => {
  jest.useFakeTimers();
  let tree;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <WhatsNewSheet />
      </ThemeProvider>,
    );
  });
  // Closed until the settle delay elapses.
  expect(tree.root.findAllByProps({ accessibilityLabel: 'got it' })).toHaveLength(0);
  await ReactTestRenderer.act(() => {
    jest.advanceTimersByTime(1600);
  });
  expect(byLabel(tree, 'got it')).toBeTruthy();

  await ReactTestRenderer.act(() => {
    byLabel(tree, 'got it').props.onPress();
  });
  expect(storage.getItem('aura.whatsNewSeen')).toBe(WHATS_NEW_BATCH);
  expect(shouldShowWhatsNew()).toBe(false);
  expect(tree.root.findAllByProps({ accessibilityLabel: 'got it' })).toHaveLength(0);

  await ReactTestRenderer.act(() => tree.unmount());
  jest.useRealTimers();
});

test('already-seen batch never auto-opens', async () => {
  jest.useFakeTimers();
  storage.setItem('aura.whatsNewSeen', WHATS_NEW_BATCH);
  let tree;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <WhatsNewSheet />
      </ThemeProvider>,
    );
  });
  await ReactTestRenderer.act(() => {
    jest.advanceTimersByTime(3000);
  });
  expect(tree.root.findAllByProps({ accessibilityLabel: 'got it' })).toHaveLength(0);
  await ReactTestRenderer.act(() => tree.unmount());
  jest.useRealTimers();
});
