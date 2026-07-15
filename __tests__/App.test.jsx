/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';
import { storage } from '../src/storage/mmkv';

test('renders sign-in when signed out', async () => {
  storage.removeItem('aura.authToken');
  storage.removeItem('aura.authUser');
  let tree;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<App />);
  });
  await ReactTestRenderer.act(() => tree.unmount());
});

test('renders the tab shell when signed in and onboarded', async () => {
  storage.setItem('aura.authToken', 'jwt');
  storage.setItem(
    'aura.authUser',
    // hasOnboarded + showSensing:false clear the first-run gates → the tab shell.
    JSON.stringify({ id: 1, name: 'aura', hasOnboarded: true, showSensing: false }),
  );
  let tree;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<App />);
  });
  await ReactTestRenderer.act(() => tree.unmount());
  storage.removeItem('aura.authToken');
  storage.removeItem('aura.authUser');
});

test('routes a signed-in, not-yet-onboarded user into onboarding', async () => {
  storage.setItem('aura.authToken', 'jwt');
  storage.setItem(
    'aura.authUser',
    // showSensing:false skips the sensing intro; no hasOnboarded → onboarding gate.
    JSON.stringify({ id: 2, name: 'nova', showSensing: false }),
  );
  let tree;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<App />);
  });
  await ReactTestRenderer.act(() => tree.unmount());
  storage.removeItem('aura.authToken');
  storage.removeItem('aura.authUser');
});
