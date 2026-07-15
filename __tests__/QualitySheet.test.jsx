import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { QualitySheet } from '../src/overlays/QualitySheet';
import { openQualitySheet } from '../src/lib/qualitySheet';

// The picker reads/writes quality through the player context (so the engine
// re-fetches the current stream), not the store directly.
const mockPlayer = { quality: 'high', setQuality: jest.fn() };
jest.mock('../src/playback/PlayerContext', () => ({
  usePlayer: () => mockPlayer,
}));

const byLabel = (tree, accessibilityLabel) =>
  tree.root.findAllByProps({ accessibilityLabel })[0];

test('picking a quality routes through player.setQuality', async () => {
  let tree;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <QualitySheet />
      </ThemeProvider>,
    );
  });
  // Closed until the bus opens it.
  await ReactTestRenderer.act(() => {
    openQualitySheet();
  });

  byLabel(tree, 'quality normal').props.onPress();
  expect(mockPlayer.setQuality).toHaveBeenCalledWith('normal');

  await ReactTestRenderer.act(() => tree.unmount());
});
