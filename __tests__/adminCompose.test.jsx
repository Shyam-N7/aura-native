import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import AdminComposeScreen from '../src/screens/AdminComposeScreen';

const mockReach = jest.fn();
const mockSend = jest.fn();
jest.mock('../src/lib/push', () => ({
  adminPushReach: (...args) => mockReach(...args),
  adminPushSend: (...args) => mockSend(...args),
}));
const mockToast = jest.fn();
jest.mock('../src/lib/toast', () => ({
  showToast: (...args) => mockToast(...args),
}));

// Rendered text only, joined in order (a Text's children can be split).
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

async function render(node) {
  let tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
}
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn() });

beforeEach(() => {
  jest.clearAllMocks();
  mockReach.mockResolvedValue({ configured: true, devices: 2, users: 1 });
  mockSend.mockResolvedValue({ sent: 2 });
});

test('empty form shows the default preview and a disabled send', async () => {
  const tree = await render(<AdminComposeScreen navigation={nav()} />);
  const body = texts(tree.toJSON());
  expect(body).toContain('hello from aura');
  expect(body).toContain('your message shows here, exactly how it lands.');
  expect(body).toContain('goes only to your own devices (a safe test).');
  expect(byLabel(tree, 'send notification').props.disabled).toBe(true);
  await ReactTestRenderer.act(() => tree.unmount());
});

test('typing feeds the live preview; send posts to me and goes back', async () => {
  const navigation = nav();
  const tree = await render(<AdminComposeScreen navigation={navigation} />);
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'notification title').props.onChangeText('fresh mixes');
    byLabel(tree, 'notification message').props.onChangeText('three new sets today.');
  });
  const body = texts(tree.toJSON());
  expect(body).toContain('fresh mixes');
  expect(body).toContain('three new sets today.');
  expect(body).not.toContain('hello from aura');

  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'send notification').props.onPress();
  });
  expect(mockSend).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'fresh mixes',
      body: 'three new sets today.',
      audience: 'me',
      image: undefined,
    }),
  );
  expect(mockToast).toHaveBeenCalledWith('sent to 2 devices.', { tick: true });
  expect(navigation.goBack).toHaveBeenCalled();
  await ReactTestRenderer.act(() => tree.unmount());
});

test('the everyone toggle sends to all', async () => {
  const tree = await render(<AdminComposeScreen navigation={nav()} />);
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'notification title').props.onChangeText('t');
    byLabel(tree, 'notification message').props.onChangeText('b');
    byLabel(tree, 'send to everyone').props.onPress();
  });
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'send notification').props.onPress();
  });
  expect(mockSend).toHaveBeenCalledWith(
    expect.objectContaining({ audience: 'all' }),
  );
  await ReactTestRenderer.act(() => tree.unmount());
});

test('a typed email wins the audience and disables the toggle', async () => {
  const tree = await render(<AdminComposeScreen navigation={nav()} />);
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'notification title').props.onChangeText('t');
    byLabel(tree, 'notification message').props.onChangeText('b');
    byLabel(tree, 'send to one email').props.onChangeText('friend@x.y');
  });
  expect(byLabel(tree, 'send to everyone').props.disabled).toBe(true);
  expect(texts(tree.toJSON())).toContain('ignored — the email above wins.');
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'send notification').props.onPress();
  });
  expect(mockSend).toHaveBeenCalledWith(
    expect.objectContaining({ audience: 'friend@x.y' }),
  );
  await ReactTestRenderer.act(() => tree.unmount());
});

test('an https image url rides the payload and the preview banner', async () => {
  const tree = await render(<AdminComposeScreen navigation={nav()} />);
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'notification title').props.onChangeText('t');
    byLabel(tree, 'notification message').props.onChangeText('b');
    byLabel(tree, 'notification image url').props.onChangeText('https://cdn.example/art.jpg');
  });
  expect(byLabel(tree, 'notification image preview').props.source).toEqual({
    uri: 'https://cdn.example/art.jpg',
  });
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'send notification').props.onPress();
  });
  expect(mockSend).toHaveBeenCalledWith(
    expect.objectContaining({ image: 'https://cdn.example/art.jpg' }),
  );
  await ReactTestRenderer.act(() => tree.unmount());
});
