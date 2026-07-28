import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  like,
  unlike,
  isLikedId,
  resetLikesStore,
  useLikes,
} from '../src/hooks/useLikes';
import { likeTrack, unlikeTrack } from '../src/api/likes';

jest.mock('../src/api/likes', () => ({
  listLikedIds: jest.fn(() => Promise.resolve([])),
  likeTrack: jest.fn(() => Promise.resolve()),
  unlikeTrack: jest.fn(() => Promise.resolve()),
}));

beforeEach(() => {
  jest.clearAllMocks();
  resetLikesStore();
});

test('like is optimistic and sticks on success', async () => {
  const p = like('t1');
  expect(isLikedId('t1')).toBe(true); // before the network resolves
  await p;
  expect(likeTrack).toHaveBeenCalledWith('t1');
  expect(isLikedId('t1')).toBe(true);
});

test('like rolls back when the server rejects', async () => {
  likeTrack.mockRejectedValueOnce(new Error('nope'));
  await expect(like('t2')).rejects.toThrow('nope');
  expect(isLikedId('t2')).toBe(false);
});

test('unlike rolls back when the server rejects', async () => {
  await like('t3');
  unlikeTrack.mockRejectedValueOnce(new Error('nope'));
  await expect(unlike('t3')).rejects.toThrow('nope');
  expect(isLikedId('t3')).toBe(true);
});

// Sign-out used to clear the subscriber Set, which silently deafened every
// consumer mounted above the Shell (the player provider never remounts, and
// its subscribe effect has [] deps) — hearts stopped repainting for the rest
// of the process.
test('a consumer mounted before a reset still repaints after it', async () => {
  const seen = [];
  function Probe() {
    const { isLiked } = useLikes();
    seen.push(isLiked('t4'));
    return null;
  }
  let tree;
  // async act so the boot fetch settles inside it, like a real first paint.
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(React.createElement(Probe));
  });

  await ReactTestRenderer.act(async () => {
    await like('t4');
  });
  expect(seen[seen.length - 1]).toBe(true);

  // sign-out: the probe repaints against the cleared store...
  await ReactTestRenderer.act(async () => {
    resetLikesStore();
  });
  expect(seen[seen.length - 1]).toBe(false);

  // ...and still follows the next account's likes.
  await ReactTestRenderer.act(async () => {
    await like('t4');
  });
  expect(seen[seen.length - 1]).toBe(true);

  await ReactTestRenderer.act(() => tree.unmount());
});
