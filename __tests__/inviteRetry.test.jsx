import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Linking } from 'react-native';
import App from '../App';
import { storage } from '../src/storage/mmkv';
import { clearSession } from '../src/lib/auth';
import { resetSessionState } from '../src/lib/sessionReset';
import { acceptPlaylistInvite } from '../src/api/playlists';

// A playlist invite token used to be marked handled BEFORE the network call
// and never released. One failed join — a 503, a flaky moment, a tunnel — and
// the link was dead for the rest of the process: tapping it again did nothing
// at all. No toast, no navigation, no sign the app was ignoring you. The
// obvious recovery for a transient failure was the one thing that could not
// work.
//
// Own file: this needs src/api/playlists mocked, and deepLinkGuard.test.jsx
// deliberately runs the real module against a rejecting fetch.
// Override ONLY the accept call — the rest of the module is used as fetchers
// by screens the app renders, and a bare stub makes them "not a function".
jest.mock('../src/api/playlists', () => ({
  ...jest.requireActual('../src/api/playlists'),
  acceptPlaylistInvite: jest.fn(),
}));
const mockToast = jest.fn();
jest.mock('../src/lib/toast', () => {
  const actual = jest.requireActual('../src/lib/toast');
  return { ...actual, showToast: (...a) => mockToast(...a) };
});

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

const tap = async url => {
  await ReactTestRenderer.act(async () => {
    urlListener()({ url });
    await new Promise(r => setTimeout(r, 0));
  });
};

beforeEach(() => {
  global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
  Linking.addEventListener.mockClear();
  acceptPlaylistInvite.mockReset();
  mockToast.mockReset();
  resetSessionState({ signedOut: true }); // drop tokens from earlier cases
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
  delete global.fetch;
  clearSession();
});

// Distinct tokens per case: the maps are module-level and outlive a test.
test('a failed join can be retried by tapping the link again', async () => {
  const link = 'https://www.aurafm.live/playlists?join=retry-me';
  acceptPlaylistInvite.mockRejectedValueOnce(new Error('could not join (503)'));
  await mount();

  await tap(link);
  expect(acceptPlaylistInvite).toHaveBeenCalledTimes(1);
  expect(mockToast).toHaveBeenCalledWith('could not join (503)');

  // The user sees the error and taps the link again. This used to be a no-op
  // forever — the token was already in the handled set.
  acceptPlaylistInvite.mockResolvedValueOnce({
    playlistId: 'p1',
    name: 'road trip',
  });
  await tap(link);

  expect(acceptPlaylistInvite).toHaveBeenCalledTimes(2);
  expect(mockToast).toHaveBeenCalledWith('Joined "road trip".');
});

test('a successful join is not re-posted, and re-tapping re-opens it', async () => {
  const link = 'https://www.aurafm.live/playlists?join=already-in';
  acceptPlaylistInvite.mockResolvedValue({ playlistId: 'p2', name: 'dinner' });
  await mount();

  await tap(link);
  expect(acceptPlaylistInvite).toHaveBeenCalledTimes(1);

  await tap(link);

  // Still one accept — but the second tap is no longer a dead end: it takes
  // you back to the playlist you already joined.
  expect(acceptPlaylistInvite).toHaveBeenCalledTimes(1);
});

test('the same link firing twice at once accepts once', async () => {
  const link = 'https://www.aurafm.live/playlists?join=double-fire';
  let release;
  acceptPlaylistInvite.mockReturnValue(
    new Promise(r => {
      release = r;
    }),
  );
  await mount();

  await ReactTestRenderer.act(async () => {
    urlListener()({ url: link });
    urlListener()({ url: link });
    await new Promise(r => setTimeout(r, 0));
  });

  expect(acceptPlaylistInvite).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(async () => {
    release({ playlistId: 'p3', name: 'x' });
    await new Promise(r => setTimeout(r, 0));
  });
});

// Same class as the six sign-out leaks already closed: a token the previous
// account accepted must not navigate the next one into a playlist they are
// not a member of.
test('a joined token does not carry across a sign-out', async () => {
  const link = 'https://www.aurafm.live/playlists?join=account-a';
  acceptPlaylistInvite.mockResolvedValue({ playlistId: 'p4', name: 'mine' });
  await mount();
  await tap(link);
  expect(acceptPlaylistInvite).toHaveBeenCalledTimes(1);

  resetSessionState({ signedOut: true });

  // The next account taps the same shared link: it must actually try to join,
  // not silently reuse the previous account's membership.
  await tap(link);
  expect(acceptPlaylistInvite).toHaveBeenCalledTimes(2);
});
