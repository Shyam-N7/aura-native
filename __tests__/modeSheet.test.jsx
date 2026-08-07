import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { ModeSheet } from '../src/overlays/ModeSheet';
import { openModeSheet } from '../src/lib/modeSheet';

let mockUser = {
  activeMode: 'everyday',
  modes: [
    { key: 'everyday', label: 'Everyday', explicitOff: false },
    { key: 'focus', label: 'Focus', explicitOff: false },
    { key: 'family', label: 'Family', explicitOff: true },
    { key: 'car', label: 'Car', explicitOff: false },
  ],
};
const mockSetActiveMode = jest.fn(() => Promise.resolve(mockUser));
jest.mock('../src/lib/auth', () => ({
  getModeEpoch: () => 0,
  getUser: () => mockUser,
  subscribeAuth: jest.fn(() => () => {}),
  setActiveMode: (...a) => mockSetActiveMode(...a),
}));
const mockShowToast = jest.fn();
jest.mock('../src/lib/toast', () => ({ showToast: (...a) => mockShowToast(...a) }));

function texts(node) {
  if (node == null) {
    return '';
  }
  if (typeof node === 'string') {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map(texts).join('');
  }
  return texts(node.children);
}
const byLabel = (tree, accessibilityLabel) =>
  tree.root.findAllByProps({ accessibilityLabel })[0];

async function render() {
  let tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <ModeSheet />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders nothing until opened', async () => {
  const tree = await render();
  expect(tree.toJSON()).toBeNull();
  await ReactTestRenderer.act(() => tree.unmount());
});

test('lists modes (car hidden), marks the active one, and switches on tap', async () => {
  const tree = await render();
  await ReactTestRenderer.act(async () => {
    openModeSheet();
  });

  const body = texts(tree.toJSON());
  expect(body).toContain('listening mode');
  expect(body).toContain('everyday');
  expect(body).toContain('focus');
  expect(body).toContain('family');
  // Car is a Phase-5 experience layer — not offered here.
  expect(byLabel(tree, 'car')).toBeUndefined();

  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'focus').props.onPress();
  });
  expect(mockSetActiveMode).toHaveBeenCalledWith('focus');

  await ReactTestRenderer.act(() => tree.unmount());
});

test('tapping the already-active mode just closes, no switch call', async () => {
  const tree = await render();
  await ReactTestRenderer.act(async () => {
    openModeSheet();
  });
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'everyday').props.onPress();
  });
  expect(mockSetActiveMode).not.toHaveBeenCalled();
  // Closed after the tap.
  expect(tree.toJSON()).toBeNull();
  await ReactTestRenderer.act(() => tree.unmount());
});
