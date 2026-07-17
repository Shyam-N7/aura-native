import {
  addNext,
  addToEnd,
  clear,
  createQueue,
  decideNext,
  dedupeAppend,
  jumpTo,
  removeAt,
  reorder,
  restoreOrder,
  serializeQueue,
  shuffleUpcoming,
} from '../src/playback/queueModel';

const t = (id, title = `song ${id}`) => ({
  id,
  title,
  artist: 'someone',
  streamUrl: `https://cdn/${id}_320.mp4`,
});

const q3 = (source = "tonight's set", idx = 0) =>
  createQueue([t('a'), t('b'), t('c')], idx, source);

describe('createQueue', () => {
  test('copies tracks and clamps idx', () => {
    const tracks = [t('a'), t('b')];
    const q = createQueue(tracks, 9, 'your set');
    expect(q.tracks).not.toBe(tracks);
    expect(q.idx).toBe(1);
    expect(q.source).toBe('your set');
    expect(createQueue([], 4).idx).toBe(0);
  });
});

describe('decideNext', () => {
  test('advances mid-queue', () => {
    expect(decideNext(q3("tonight's set", 0), 'off')).toEqual({
      action: 'advance',
      nextIdx: 1,
    });
  });

  test("tonight's set wraps to 0 at the end", () => {
    expect(decideNext(q3("tonight's set", 2), 'off')).toEqual({
      action: 'wrap',
      nextIdx: 0,
    });
  });

  test('repeat all wraps any source at the end', () => {
    expect(decideNext(q3('your set', 2), 'all')).toEqual({
      action: 'wrap',
      nextIdx: 0,
    });
  });

  test('repeat one replays the current track', () => {
    expect(decideNext(q3('your set', 1), 'one')).toEqual({
      action: 'wrap',
      nextIdx: 1,
    });
  });

  test("'more like this' goes to radio at the end", () => {
    expect(decideNext(q3('more like this', 2), 'off')).toEqual({
      action: 'radio',
      nextIdx: 3,
    });
  });

  test('every other non-wrapping source also radios at the end (web parity)', () => {
    for (const source of ['your pick', 'your set', 'your selection']) {
      expect(decideNext(q3(source, 2), 'off')).toEqual({
        action: 'radio',
        nextIdx: 3,
      });
    }
  });

  test('empty queue stops', () => {
    expect(decideNext(createQueue([]), 'off').action).toBe('stop');
  });
});

describe('jumpTo', () => {
  test('clamps into range and no-ops on same idx', () => {
    const q = q3("tonight's set", 0);
    expect(jumpTo(q, 2).idx).toBe(2);
    expect(jumpTo(q, 99).idx).toBe(2);
    expect(jumpTo(q, -5).idx).toBe(0);
    expect(jumpTo(q, 0)).toBe(q);
  });
});

describe('removeAt', () => {
  test('removing before current shifts idx down', () => {
    const q = removeAt(q3("tonight's set", 1), 0);
    expect(q.tracks.map(x => x.id)).toEqual(['b', 'c']);
    expect(q.idx).toBe(0);
  });

  test('removing current keeps idx on the track that slides in', () => {
    const q = removeAt(q3("tonight's set", 1), 1);
    expect(q.tracks.map(x => x.id)).toEqual(['a', 'c']);
    expect(q.idx).toBe(1);
  });

  test('removing the current last track re-clamps idx', () => {
    const q = removeAt(q3("tonight's set", 2), 2);
    expect(q.idx).toBe(1);
  });

  test('out-of-range is a no-op (same reference)', () => {
    const q = q3();
    expect(removeAt(q, 7)).toBe(q);
    expect(removeAt(q, -1)).toBe(q);
  });
});

describe('addNext / addToEnd', () => {
  test('addNext inserts after current and flips the featured source', () => {
    const q = addNext(q3("tonight's set", 1), t('x'));
    expect(q.tracks.map(x => x.id)).toEqual(['a', 'b', 'x', 'c']);
    expect(q.source).toBe('your set');
  });

  test('addToEnd appends and keeps a curated source', () => {
    const q = addToEnd(q3('more like this', 0), t('x'));
    expect(q.tracks.map(x => x.id)).toEqual(['a', 'b', 'c', 'x']);
    expect(q.source).toBe('more like this');
  });
});

describe('shuffleUpcoming', () => {
  test('pins history + current, shuffles only the tail', () => {
    const tracks = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => t(id));
    const q = createQueue(tracks, 2, 'your set');
    // Reversing rng: j = i-1 each round rotates the tail deterministically.
    const shuffled = shuffleUpcoming(q, () => 0.99);
    expect(shuffled.tracks.slice(0, 3).map(x => x.id)).toEqual(['a', 'b', 'c']);
    expect(
      shuffled.tracks
        .slice(3)
        .map(x => x.id)
        .sort(),
    ).toEqual(['d', 'e', 'f']);
    expect(shuffled.idx).toBe(2);
  });

  test('an at-end queue reshuffles the whole set, keeping the playing track', () => {
    const q = q3('your set', 2); // 'c' plays, nothing is up next
    // rng () => 0 reorders deterministically: [a,b,c] → [b,c,a].
    const s = shuffleUpcoming(q, () => 0);
    expect(s.tracks.map(x => x.id).sort()).toEqual(['a', 'b', 'c']);
    expect(s.tracks.map(x => x.id)).not.toEqual(['a', 'b', 'c']);
    expect(s.tracks[s.idx].id).toBe('c');
  });

  test('a single-track queue is a no-op (same reference)', () => {
    const q = createQueue([t('a')], 0, 'your set');
    expect(shuffleUpcoming(q)).toBe(q);
  });
});

describe('restoreOrder', () => {
  test('round-trips a shuffle back to the original order', () => {
    const tracks = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => t(id));
    const q = createQueue(tracks, 2, 'your set');
    const shuffled = shuffleUpcoming(q, () => 0.99);
    const back = restoreOrder(shuffled, q.tracks);
    expect(back.tracks.map(x => x.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(back.tracks[back.idx].id).toBe('c');
  });

  test('tracks removed while shuffled stay gone', () => {
    const q = createQueue(['a', 'b', 'c', 'd'].map(id => t(id)), 0, 'your set');
    const shuffled = shuffleUpcoming(q, () => 0.99);
    const trimmed = removeAt(shuffled, shuffled.tracks.findIndex(x => x.id === 'd'));
    const back = restoreOrder(trimmed, q.tracks);
    expect(back.tracks.map(x => x.id)).toEqual(['a', 'b', 'c']);
    expect(back.tracks[back.idx].id).toBe('a');
  });

  test('tracks added while shuffled follow at the end', () => {
    const q = createQueue(['a', 'b', 'c'].map(id => t(id)), 0, 'your set');
    const shuffled = shuffleUpcoming(q, () => 0.99);
    const grown = addToEnd(shuffled, t('x'));
    const back = restoreOrder(grown, q.tracks);
    expect(back.tracks.map(x => x.id)).toEqual(['a', 'b', 'c', 'x']);
  });

  test('a song queued twice survives the round-trip (occurrence counts)', () => {
    const dup = t('b');
    const tracks = [t('a'), dup, t('c'), dup];
    const q = createQueue(tracks, 0, 'your set');
    const shuffled = shuffleUpcoming(q, () => 0.99);
    const back = restoreOrder(shuffled, q.tracks);
    expect(back.tracks.map(x => x.id)).toEqual(['a', 'b', 'c', 'b']);
  });

  test('no snapshot is a no-op (same reference)', () => {
    const q = q3();
    expect(restoreOrder(q, null)).toBe(q);
    expect(restoreOrder(q, [])).toBe(q);
  });
});

describe('dedupeAppend', () => {
  test('drops ids already queued', () => {
    const q = dedupeAppend(q3(), [t('a'), t('x')]);
    expect(q.tracks.map(x => x.id)).toEqual(['a', 'b', 'c', 'x']);
  });

  test('drops covers by normalized title key', () => {
    const base = createQueue(
      [t('a', 'Marandhu Poche (From "Some Movie")')],
      0,
      'more like this',
    );
    const q = dedupeAppend(base, [
      { id: 'cover', title: 'marandhu poche', artist: 'other' },
      t('x', 'Fresh Song'),
    ]);
    expect(q.tracks.map(x => x.id)).toEqual(['a', 'x']);
  });

  test('dedupes within the batch itself', () => {
    const q = dedupeAppend(q3(), [
      t('x', 'Same Song'),
      { id: 'y', title: 'same song', artist: 'other' },
    ]);
    expect(q.tracks.map(x => x.id)).toEqual(['a', 'b', 'c', 'x']);
  });

  test('nothing fresh returns the same reference', () => {
    const q = q3();
    expect(dedupeAppend(q, [t('a')])).toBe(q);
    expect(dedupeAppend(q, [])).toBe(q);
  });
});

describe('reorder', () => {
  const ids = q => q.tracks.map(x => x.id);

  test('moves a track and keeps the playing one pinned', () => {
    const q = reorder(q3("tonight's set", 1), 0, 2);
    expect(ids(q)).toEqual(['b', 'c', 'a']);
    expect(q.tracks[q.idx].id).toBe('b'); // was playing b, still playing b
  });

  test('moving the current track re-points idx at it', () => {
    const q = reorder(q3("tonight's set", 0), 0, 2);
    expect(ids(q)).toEqual(['b', 'c', 'a']);
    expect(q.idx).toBe(2);
  });

  test('moving a later track above the current shifts idx up', () => {
    const q = reorder(q3("tonight's set", 1), 2, 0);
    expect(ids(q)).toEqual(['c', 'a', 'b']);
    expect(q.idx).toBe(2);
    expect(q.tracks[q.idx].id).toBe('b');
  });

  test('no-ops on same index or out-of-range moves', () => {
    const q = q3();
    expect(reorder(q, 1, 1)).toBe(q);
    expect(reorder(q, -1, 2)).toBe(q);
    expect(reorder(q, 0, 3)).toBe(q);
  });
});

describe('clear', () => {
  test("keeps only the playing track as a fresh 'your set'", () => {
    const q = clear(q3('more like this', 1));
    expect(q.tracks.map(x => x.id)).toEqual(['b']);
    expect(q.idx).toBe(0);
    expect(q.source).toBe('your set');
  });

  test('single-track and empty queues are no-ops (same reference)', () => {
    const single = createQueue([t('a')], 0, 'your set');
    expect(clear(single)).toBe(single);
    const empty = createQueue([]);
    expect(clear(empty)).toBe(empty);
  });
});

describe('serializeQueue', () => {
  test('strips streamUrl and keeps idx/source', () => {
    const s = serializeQueue(q3('your set', 1));
    expect(s.idx).toBe(1);
    expect(s.source).toBe('your set');
    expect(s.tracks).toHaveLength(3);
    for (const track of s.tracks) {
      expect(track.streamUrl).toBeUndefined();
      expect(track.id).toBeTruthy();
      expect(track.title).toBeTruthy();
    }
  });

  test('defaults for a missing queue', () => {
    expect(serializeQueue(null)).toEqual({
      tracks: [],
      idx: 0,
      source: "tonight's set",
    });
  });
});
