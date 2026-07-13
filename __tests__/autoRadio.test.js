import { getRelated } from '../src/api/related';
import * as autoRadio from '../src/playback/autoRadio';
import { createQueue } from '../src/playback/queueModel';

jest.mock('../src/api/related', () => ({ getRelated: jest.fn() }));

const t = (id, title = `song ${id}`) => ({ id, title, artist: 'someone' });

const radioQueue = () =>
  createQueue([t('seed', 'Seed Song')], 0, 'more like this');

beforeEach(() => {
  autoRadio.reset();
  getRelated.mockReset();
});

test('extend retries once on failure and appends the batch', async () => {
  getRelated
    .mockRejectedValueOnce(new Error('blip'))
    .mockResolvedValueOnce([t('x', 'Fresh One')]);

  const out = await autoRadio.extend(radioQueue());

  expect(getRelated).toHaveBeenCalledTimes(2);
  expect(getRelated).toHaveBeenCalledWith('seed', {
    lang: undefined,
    limit: 15,
  });
  expect(out.tracks.map(x => x.id)).toEqual(['seed', 'x']);
  expect(out.source).toBe('more like this');
});

test('extend gives up after the retry also fails', async () => {
  getRelated.mockRejectedValue(new Error('down'));
  const out = await autoRadio.extend(radioQueue());
  expect(getRelated).toHaveBeenCalledTimes(2);
  expect(out).toBeNull();
});

test('noteQueueState prefetches for the last track; extend consumes it', async () => {
  getRelated.mockResolvedValue([t('x', 'Fresh One')]);
  const q = radioQueue();

  autoRadio.noteQueueState(q, 'off');
  autoRadio.noteQueueState(q, 'off'); // same seed — no second fetch
  const out = await autoRadio.extend(q);

  expect(getRelated).toHaveBeenCalledTimes(1);
  expect(getRelated).toHaveBeenCalledWith('seed', {
    lang: undefined,
    limit: 15,
  });
  expect(out.tracks.map(x => x.id)).toEqual(['seed', 'x']);
});

test("a 'your pick' queue radios too — extend flips the source", async () => {
  getRelated.mockResolvedValue([t('x', 'Fresh One')]);
  const q = createQueue([t('seed', 'Seed Song')], 0, 'your pick');

  autoRadio.noteQueueState(q, 'off');
  const out = await autoRadio.extend(q);

  expect(getRelated).toHaveBeenCalledTimes(1);
  expect(out.tracks.map(x => x.id)).toEqual(['seed', 'x']);
  expect(out.source).toBe('more like this');
});

test('prefetch passes the seed language along', () => {
  getRelated.mockResolvedValue([]);
  const q = createQueue(
    [{ ...t('seed'), language: 'tamil' }],
    0,
    'more like this',
  );
  autoRadio.noteQueueState(q, 'off');
  expect(getRelated).toHaveBeenCalledWith('seed', {
    lang: 'tamil',
    limit: 15,
  });
});

test('no prefetch off the last track, on wrapping sources, or under repeat', () => {
  getRelated.mockResolvedValue([]);
  autoRadio.noteQueueState(
    createQueue([t('a'), t('b')], 0, 'more like this'),
    'off',
  );
  autoRadio.noteQueueState(createQueue([t('a')], 0, "tonight's set"), 'off');
  autoRadio.noteQueueState(radioQueue(), 'all');
  autoRadio.noteQueueState(radioQueue(), 'one');
  expect(getRelated).not.toHaveBeenCalled();
});

test('apply dedupes by id AND normalized title', async () => {
  getRelated.mockResolvedValue([
    t('seed', 'Seed Song'), // already queued (id)
    { id: 'cover', title: 'seed song (From "Movie")', artist: 'other' }, // cover
    t('x', 'Fresh One'),
  ]);

  const out = await autoRadio.extend(radioQueue());
  expect(out.tracks.map(x => x.id)).toEqual(['seed', 'x']);
});

test('a batch with nothing fresh returns null', async () => {
  getRelated.mockResolvedValue([t('seed', 'Seed Song')]);
  expect(await autoRadio.extend(radioQueue())).toBeNull();
});

test('a failed prefetch clears state so extend can fetch fresh', async () => {
  getRelated
    .mockRejectedValueOnce(new Error('a'))
    .mockRejectedValueOnce(new Error('b'));
  const q = radioQueue();
  autoRadio.noteQueueState(q, 'off');
  // Let the failed prefetch settle.
  await new Promise(resolve => setTimeout(resolve, 0));

  getRelated.mockResolvedValue([t('x', 'Fresh One')]);
  const out = await autoRadio.extend(q);
  expect(out.tracks.map(x => x.id)).toEqual(['seed', 'x']);
});
