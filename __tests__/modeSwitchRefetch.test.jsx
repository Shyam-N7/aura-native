import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { getFeatured } from '../src/api/catalog';
import { useFeaturedPool } from '../src/hooks/useFeaturedPool';
import { fetchMe, setActiveMode } from '../src/lib/auth';
import { storage } from '../src/storage/mmkv';

// Switching listening mode used to serve the OLD mode's content for the rest
// of the session.
//
// setActiveMode persists optimistically and notifies BEFORE the POST, which is
// what makes the picker feel instant. But getFeatured sends no mode param —
// the server derives it from the auth user — so that first fetch can reach the
// server before the switch has committed there, and come back with the
// previous mode's pool. It is then cached under the NEW mode's key.
//
// The confirmation notify could not correct it: persistUser re-writes the SAME
// activeMode string, so a hook deriving a primitive from it sees no change and
// React bails out of the re-render. Nothing ever re-fetched. A
// server-confirmation epoch is what makes the corrective fetch happen.

jest.mock('../src/api/catalog', () => ({ getFeatured: jest.fn() }));
jest.mock('../src/lib/snapshot', () => ({
  readSnapshot: () => null,
  writeSnapshot: jest.fn(),
  snapshotOwner: () => 'owner',
}));

let tree = null;
const mount = async () => {
  function Probe() {
    useFeaturedPool({ limit: 24 });
    return null;
  }
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<Probe />);
    await Promise.resolve();
  });
};
const unmount = async () => {
  if (!tree) {
    return;
  }
  await ReactTestRenderer.act(async () => tree.unmount());
  tree = null;
};

const serverSays = user =>
  jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ user }) }));

beforeEach(() => {
  jest.clearAllMocks();
  getFeatured.mockResolvedValue([{ id: 't1', title: 'one' }]);
  storage.setItem('aura.authToken', 'jwt');
  storage.setItem(
    'aura.authUser',
    JSON.stringify({ id: 1, activeMode: 'everyday' }),
  );
});

afterEach(async () => {
  await unmount();
  delete global.fetch;
  storage.removeItem('aura.authUser');
  storage.removeItem('aura.authToken');
});

test('a confirmed mode switch fetches again, after the server agrees', async () => {
  await mount();
  expect(getFeatured).toHaveBeenCalledTimes(1); // the mount fetch

  // Hold the POST open so the OPTIMISTIC flip commits on its own first. This
  // matters: resolved inside one act(), the flip and the confirmation batch
  // into a single commit and the counts are identical with or without the
  // epoch — the test would prove nothing.
  let confirmPost;
  global.fetch = jest.fn(
    () =>
      new Promise(resolve => {
        confirmPost = resolve;
      }),
  );
  let switching;
  await ReactTestRenderer.act(async () => {
    switching = setActiveMode('focus');
    await Promise.resolve();
  });

  // The optimistic flip re-pulls the pool immediately — the instant feel.
  // This request can beat the POST to the server, which is the whole problem:
  // getFeatured carries no mode param, so the server may still answer for the
  // OLD mode and that answer gets cached under the NEW mode's key.
  expect(getFeatured).toHaveBeenCalledTimes(2);

  await ReactTestRenderer.act(async () => {
    confirmPost({
      ok: true,
      status: 200,
      json: async () => ({ user: { id: 1, activeMode: 'focus' } }),
    });
    await switching;
  });

  // The corrective fetch, now that the server has actually committed. Without
  // the epoch this stayed at 2: persistUser re-writes the SAME activeMode
  // string, so the hook's derived primitive is unchanged and React bails.
  expect(getFeatured).toHaveBeenCalledTimes(3);
});

test('an auth notify that is not a mode change does not refetch', async () => {
  await mount();
  expect(getFeatured).toHaveBeenCalledTimes(1);

  // Auth notifies for plenty of reasons — an avatar change, a preferences
  // refresh. Home must not re-pull its whole pool for those.
  global.fetch = serverSays({
    id: 1,
    activeMode: 'everyday',
    avatarUrl: 'x.png',
  });
  await ReactTestRenderer.act(async () => {
    await fetchMe();
  });

  expect(getFeatured).toHaveBeenCalledTimes(1);
});

test('a rejected switch reverts, and Home follows it back', async () => {
  await mount();
  expect(getFeatured).toHaveBeenCalledTimes(1);

  // Hold the POST open so the optimistic flip COMMITS first, the way it does
  // in life. Batched into one act() the two persistUser calls collapse and the
  // mode never visibly changes — which is a real (and good) property, but it
  // hides the sequence this is about.
  let rejectPost;
  global.fetch = jest.fn(
    () =>
      new Promise((_, reject) => {
        rejectPost = reject;
      }),
  );
  let switching;
  await ReactTestRenderer.act(async () => {
    switching = setActiveMode('focus').catch(() => {});
    await Promise.resolve();
  });

  // The flip alone already re-pulled the pool — that is the instant feel.
  expect(getFeatured).toHaveBeenCalledTimes(2);

  await ReactTestRenderer.act(async () => {
    rejectPost(new Error('offline'));
    await switching;
  });

  // ...and the revert pulls it back. Home never sits showing a mode the
  // server refused.
  expect(getFeatured).toHaveBeenCalledTimes(3);
});
