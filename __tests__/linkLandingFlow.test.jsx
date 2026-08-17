import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Linking } from 'react-native';
import App from '../App';
import { storage } from '../src/storage/mmkv';
import { clearSession } from '../src/lib/auth';
import { clearTrackCache } from '../src/api/catalog';

// The landing through the REAL App: a tapped link paints its errand while the
// fetch runs, dissolves on arrival, self-clears on failure, and never rises
// for a signed-out user. Harness per deepLinkGuard.test.jsx.

const SIGNED_IN = JSON.stringify({
  id: 7,
  name: 'aura',
  hasOnboarded: true,
  showSensing: false,
});

let tree = null;
const settle = () =>
  ReactTestRenderer.act(async () => {
    await new Promise(r => setTimeout(r, 0));
  });
const mount = async () => {
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App />);
  });
  await settle();
};
// react-navigation registers its own 'url' listeners around the app's, so
// "the last one" is not reliably ours — select the App wrapper by source.
const urlListener = () =>
  Linking.addEventListener.mock.calls
    .filter(c => c[0] === 'url' && String(c[1]).includes('handleLink'))
    .pop()[1];
const texts = n =>
  n == null ? '' : typeof n === 'string' ? n : Array.isArray(n) ? n.map(texts).join('') : texts(n.children);

beforeEach(() => {
  global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
  Linking.addEventListener.mockClear();
  Linking.getInitialURL.mockClear();
  storage.setItem('aura.authToken', 'jwt');
  storage.setItem('aura.authUser', SIGNED_IN);
  clearTrackCache();
});

afterEach(async () => {
  if (tree) {
    await ReactTestRenderer.act(async () => {
      tree.unmount();
    });
    tree = null;
  }
  delete global.fetch;
  clearSession();
});

const trackBody = id =>
  JSON.stringify({ id, title: 'Song', artist: 'A', durationSec: 200, streamUrl: 'u' });

test('a song link wears its errand while the fetch runs, then dissolves into the player', async () => {
  let release;
  global.fetch = jest.fn(url => {
    if (String(url).includes('/api/catalog/track/')) {
      return new Promise(r => {
        release = () =>
          r({ ok: true, status: 200, json: async () => JSON.parse(trackBody('x9')) });
      });
    }
    return Promise.reject(new Error('offline'));
  });
  await mount();

  await ReactTestRenderer.act(async () => {
    urlListener()({ url: 'https://www.aurafm.live/t/x9?src=share' });
  });
  expect(texts(tree.toJSON())).toContain('opening the song');

  await ReactTestRenderer.act(async () => {
    release();
    await new Promise(r => setTimeout(r, 0));
  });
  // The dissolve rides a real ~200ms fade before the host unmounts.
  await ReactTestRenderer.act(async () => {
    await new Promise(r => setTimeout(r, 450));
  });
  expect(texts(tree.toJSON())).not.toContain('opening the song');
});

test('a moment link says where it will start', async () => {
  global.fetch = jest.fn(url =>
    String(url).includes('/api/catalog/track/')
      ? new Promise(() => {})   // never resolves — the label is the assertion
      : Promise.reject(new Error('offline')),
  );
  await mount();
  await ReactTestRenderer.act(async () => {
    urlListener()({ url: 'https://www.aurafm.live/t/x1?at=84' });
  });
  expect(texts(tree.toJSON())).toContain('starting from 1:24');
});

test('a failed fetch clears the landing and says so', async () => {
  global.fetch = jest.fn(url =>
    String(url).includes('/api/catalog/track/')
      ? Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
      : Promise.reject(new Error('offline')),
  );
  await mount();
  await ReactTestRenderer.act(async () => {
    urlListener()({ url: 'https://www.aurafm.live/t/gone' });
  });
  await ReactTestRenderer.act(async () => {
    await new Promise(r => setTimeout(r, 450));
  });
  const body = texts(tree.toJSON());
  expect(body).not.toContain('opening the song');
  expect(body).toContain("couldn't open that song.");
});

test('the same link fired twice within the window is one intent, not two', async () => {
  global.fetch = jest.fn(url =>
    String(url).includes('/api/catalog/track/')
      ? new Promise(() => {})
      : Promise.reject(new Error('offline')),
  );
  await mount();
  await ReactTestRenderer.act(async () => {
    urlListener()({ url: 'https://www.aurafm.live/t/dup1' });
    urlListener()({ url: 'https://www.aurafm.live/t/dup1' });
  });
  const trackCalls = global.fetch.mock.calls.filter(c =>
    String(c[0]).includes('/api/catalog/track/'),
  );
  expect(trackCalls).toHaveLength(1);
});

test('signed out, a link raises no landing over the auth screen', async () => {
  clearSession();
  storage.removeItem('aura.authToken');
  storage.removeItem('aura.authUser');
  await mount();
  await ReactTestRenderer.act(async () => {
    urlListener()({ url: 'https://www.aurafm.live/t/x1' });
  });
  expect(texts(tree.toJSON())).not.toContain('opening the song');
});

test('a cold main-flow start paints the landing from the launch intent', async () => {
  Linking.getInitialURL.mockResolvedValue('https://www.aurafm.live/t/cold1');
  global.fetch = jest.fn(url =>
    String(url).includes('/api/catalog/track/')
      ? new Promise(() => {})
      : Promise.reject(new Error('offline')),
  );
  await mount();
  expect(texts(tree.toJSON())).toContain('opening the song');
});
