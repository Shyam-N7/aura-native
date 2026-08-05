import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Linking } from 'react-native';
// Deep import on purpose: the hazard IS this specific class, and the top-level
// entry does not re-export it. Reaching for the global would test node's
// implementation, which is exactly the mistake this file exists to avoid.
// eslint-disable-next-line @react-native/no-deep-imports
import { URLSearchParams as DeviceURLSearchParams } from 'react-native/Libraries/Blob/URLSearchParams';
import App from '../App';
import { storage } from '../src/storage/mmkv';
import { clearSession } from '../src/lib/auth';

// A deep link is free text: an Android intent, or push's data.link typed by
// hand in the admin console. React Native's URLSearchParams decodes every pair
// in its CONSTRUCTOR, so a truncated % escape throws URIError out of
// `parsed.searchParams` — not out of `new URL` — synchronously inside the
// native 'url' callback, where a throw takes the app down.
//
// jest cannot reproduce that on its own: RN's URL.js only RE-EXPORTS
// URLSearchParams, so the identifier inside its searchParams getter resolves
// to the global one, which here is node's forgiving implementation. Asserting
// against the real URL class under jest therefore passes whatever the app
// does, which is worse than no test. So: pin the hazard against RN's actual
// class (first test), then reproduce its semantics deterministically to
// exercise OUR guard (the rest).

const nodeURL = global.URL;

// node's URL with RN's eager-decode semantics grafted on.
class DeviceLikeURL extends nodeURL {
  get searchParams() {
    this.search
      .replace(/^\?/, '')
      .split('&')
      .filter(Boolean)
      .forEach(pair =>
        pair
          .split('=')
          .forEach(part => decodeURIComponent(part.replace(/\+/g, ' '))),
      );
    return super.searchParams;
  }
}

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

const urlListener = () =>
  Linking.addEventListener.mock.calls.filter(c => c[0] === 'url').pop()[1];

beforeEach(() => {
  global.URL = DeviceLikeURL;
  global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
  Linking.addEventListener.mockClear();
  Linking.getInitialURL.mockClear();
  storage.setItem('aura.authToken', 'jwt');
  storage.setItem('aura.authUser', SIGNED_IN);
});

afterEach(async () => {
  if (tree) {
    await ReactTestRenderer.act(async () => {
      tree.unmount();
    });
    tree = null;
  }
  global.URL = nodeURL;
  delete global.fetch;
  clearSession();
});

// The hazard itself, against the class that actually ships.
test("RN's URLSearchParams throws on a truncated escape", () => {
  expect(() => new DeviceURLSearchParams('?at=%E0%A4')).toThrow();
  expect(() => new DeviceURLSearchParams('?at=42')).not.toThrow();
});

test('a malformed link is dropped, not thrown, in the native url callback', async () => {
  await mount();
  // onReady is what asks for the launch intent, so this also says the handler
  // is past its "hold until nav is ready" gate and really parses the link.
  expect(Linking.getInitialURL).toHaveBeenCalled();

  expect(() =>
    urlListener()({ url: 'https://aurafm.live/playlists?join=summer%2' }),
  ).not.toThrow();
});

test('a failed launch-intent lookup is not left as an unhandled rejection', async () => {
  const boom = new Error('no activity');
  Linking.getInitialURL.mockRejectedValueOnce(boom);
  const seen = [];
  const onUnhandled = err => seen.push(err);
  process.on('unhandledRejection', onUnhandled);

  await mount();
  await ReactTestRenderer.act(async () => {
    await new Promise(r => setImmediate(r));
  });
  process.off('unhandledRejection', onUnhandled);

  expect(seen).not.toContain(boom);
});

// handleLink acted on pathname/searchParams without ever asking WHO sent the
// link. Both feeds are untrusted: MainActivity is exported + singleTask, so any
// installed app can send an explicit-component ACTION_VIEW with an arbitrary
// URI and bypass the manifest's host filter; and push data.link is free text.
// The expensive branch is `join`, which POSTs an invite acceptance under the
// signed-in user — a link from anywhere could enrol them in a stranger's
// playlist.
test('a link from another origin is ignored', async () => {
  await mount();
  const onUrl = urlListener();

  await ReactTestRenderer.act(async () => {
    onUrl({ url: 'https://evil.example.com/playlists?join=stolen-token' });
    onUrl({ url: 'https://evil.example.com/t/some-track' });
    await new Promise(r => setTimeout(r, 0));
  });

  const urls = global.fetch.mock.calls.map(c => String(c[0]));
  expect(urls.some(u => u.includes('/invite/'))).toBe(false);
  expect(urls.some(u => u.includes('/api/catalog/track/'))).toBe(false);
});

// A lookalike host must not pass by prefix/suffix accident.
test('a host that merely contains ours is ignored', async () => {
  await mount();
  const onUrl = urlListener();

  await ReactTestRenderer.act(async () => {
    onUrl({ url: 'https://aurafm.live.evil.com/t/nope' });
    onUrl({ url: 'https://notaurafm.live/t/nope2' });
    await new Promise(r => setTimeout(r, 0));
  });

  const urls = global.fetch.mock.calls.map(c => String(c[0]));
  expect(urls.some(u => u.includes('/api/catalog/track/'))).toBe(false);
});

// http:// on our own host is still not our link — the manifest only declares
// https, and an attacker who can force plaintext should not get the join path.
test('a plaintext link to our own host is ignored', async () => {
  await mount();
  const onUrl = urlListener();

  await ReactTestRenderer.act(async () => {
    // A token this file has not used elsewhere: handledTokens is module-level
    // and de-dupes for the life of the process, so a repeat would be skipped
    // for the wrong reason and the test would pass without the guard.
    onUrl({ url: 'http://aurafm.live/playlists?join=plaintext-token' });
    await new Promise(r => setTimeout(r, 0));
  });

  expect(
    global.fetch.mock.calls.some(c => String(c[0]).includes('/invite/')),
  ).toBe(false);
});

test('a good song link still routes after a malformed one', async () => {
  await mount();
  const onUrl = urlListener();

  await ReactTestRenderer.act(async () => {
    onUrl({ url: 'https://aurafm.live/t/broken?at=%E0%A4' });
    onUrl({ url: 'https://aurafm.live/t/shared-one?at=42' });
    await new Promise(r => setTimeout(r, 0));
  });

  const urls = global.fetch.mock.calls.map(c => String(c[0]));
  const asked = id => urls.some(u => u.includes(`/api/catalog/track/${id}`));
  expect(asked('shared-one')).toBe(true);
  // Dropped whole rather than half-handled — the guard returns before any
  // branch runs, so nothing is fetched for the link that could not be parsed.
  expect(asked('broken')).toBe(false);
});
