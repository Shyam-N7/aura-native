/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import AuthScreen from '../src/screens/AuthScreen';
import { login, signup } from '../src/lib/auth';

jest.mock('../src/lib/auth', () => ({
  login: jest.fn(),
  signup: jest.fn(),
  verifyOtp: jest.fn(),
  resendOtp: jest.fn(),
  forgotRequest: jest.fn(),
  verifyResetOtp: jest.fn(),
  resetPassword: jest.fn(),
}));

async function renderScreen() {
  let tree;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <AuthScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

const rendered = tree => JSON.stringify(tree.toJSON());
const byTestId = (tree, id) => tree.root.findAllByProps({ testID: id })[0];

async function type(tree, id, text) {
  await ReactTestRenderer.act(async () => {
    byTestId(tree, id).props.onChangeText(text);
  });
}

async function press(tree, id) {
  await ReactTestRenderer.act(async () => {
    byTestId(tree, id).props.onPress();
  });
}

const unmount = tree => ReactTestRenderer.act(() => tree.unmount());

afterEach(() => {
  jest.clearAllMocks();
});

test('renders the sign-in form', async () => {
  const tree = await renderScreen();
  expect(rendered(tree)).toContain('welcome back.');
  await unmount(tree);
});

test('validates fields before calling the api', async () => {
  const tree = await renderScreen();
  await press(tree, 'auth-submit');
  expect(rendered(tree)).toContain('an email is needed.');
  expect(login).not.toHaveBeenCalled();
  await unmount(tree);
});

test('signs in with email and password', async () => {
  login.mockResolvedValue({ id: 1, name: 'aura' });
  const tree = await renderScreen();
  await type(tree, 'auth-email', 'a@b.co');
  await type(tree, 'auth-password', 'secret123');
  await press(tree, 'auth-submit');
  expect(login).toHaveBeenCalledWith('a@b.co', 'secret123');
  await unmount(tree);
});

test('signup routes to the verification code step', async () => {
  signup.mockResolvedValue({ pendingVerification: true, email: 'a@b.co' });
  const tree = await renderScreen();
  await press(tree, 'auth-switch-mode');
  expect(rendered(tree)).toContain('create your account.');
  await type(tree, 'auth-name', 'shyam');
  await type(tree, 'auth-email', 'a@b.co');
  await type(tree, 'auth-password', 'secret123');
  await press(tree, 'auth-submit');
  expect(signup).toHaveBeenCalledWith('shyam', 'a@b.co', 'secret123');
  expect(rendered(tree)).toContain('check your email for a 6-digit code');
  await unmount(tree);
});

test('device limit shows the picker and retries with eviction', async () => {
  login
    .mockResolvedValueOnce({
      code: 'device_limit',
      sessions: [{ id: 's1', deviceLabel: 'pixel 8', lastSeenAt: Date.now() }],
      limit: 2,
    })
    .mockResolvedValueOnce({ id: 1 });
  const tree = await renderScreen();
  await type(tree, 'auth-email', 'a@b.co');
  await type(tree, 'auth-password', 'secret123');
  await press(tree, 'auth-submit');
  expect(rendered(tree)).toContain('device limit reached.');
  expect(rendered(tree)).toContain('pixel 8');
  await press(tree, 'auth-evict-s1');
  expect(login).toHaveBeenLastCalledWith('a@b.co', 'secret123', 's1');
  await unmount(tree);
});
