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

test('renders the tab shell when signed in', async () => {
  storage.setItem('aura.authToken', 'jwt');
  storage.setItem('aura.authUser', JSON.stringify({ id: 1, name: 'aura' }));
  let tree;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<App />);
  });
  await ReactTestRenderer.act(() => tree.unmount());
  storage.removeItem('aura.authToken');
  storage.removeItem('aura.authUser');
});
