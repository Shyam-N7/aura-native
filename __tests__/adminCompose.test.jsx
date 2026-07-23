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

test('empty form shows the default preview, the aura card and a disabled send', async () => {
  const tree = await render(<AdminComposeScreen navigation={nav()} />);
  const body = texts(tree.toJSON());
  expect(body).toContain('hello from aura');
  expect(body).toContain('your message shows here, exactly how it lands.');
  expect(body).toContain('goes only to your own devices (a safe test).');
  // No image typed → the brand-only composed card is the banner.
  expect(byLabel(tree, 'notification image preview').props.source).toEqual({
    uri: 'https://www.aurafm.live/api/push/card-art',
  });
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
      // Every push wears a card — empty image field = the brand-only card.
      image: 'https://www.aurafm.live/api/push/card-art',
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

test('catalog art gets composited; foreign https urls ride raw', async () => {
  const art = 'https://c.saavncdn.com/795/AM-500x500.jpg';
  const composed = `https://www.aurafm.live/api/push/card-art?art=${encodeURIComponent(art)}`;
  const tree = await render(<AdminComposeScreen navigation={nav()} />);
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'notification title').props.onChangeText('t');
    byLabel(tree, 'notification message').props.onChangeText('b');
    byLabel(tree, 'notification image url').props.onChangeText(art);
  });
  expect(byLabel(tree, 'notification image preview').props.source).toEqual({
    uri: composed,
  });
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'send notification').props.onPress();
  });
  expect(mockSend).toHaveBeenCalledWith(
    expect.objectContaining({ image: composed }),
  );
  await ReactTestRenderer.act(() => tree.unmount());

  // A non-aura host can't be composited (the public endpoint only fetches
  // aura-hosted art) — it previews and sends exactly as typed.
  const tree2 = await render(<AdminComposeScreen navigation={nav()} />);
  await ReactTestRenderer.act(async () => {
    byLabel(tree2, 'notification image url').props.onChangeText('https://cdn.example/x.jpg');
  });
  expect(byLabel(tree2, 'notification image preview').props.source).toEqual({
    uri: 'https://cdn.example/x.jpg',
  });
  await ReactTestRenderer.act(() => tree2.unmount());
});
