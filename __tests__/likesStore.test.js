import {
  like,
  unlike,
  isLikedId,
  resetLikesStore,
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
