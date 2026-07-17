import {
  HINT_KARAOKE,
  HINT_LIKE,
  hintDone,
  markHintDone,
  subscribeHints,
} from '../src/lib/hints';
import { storage } from '../src/storage/mmkv';

beforeEach(() => {
  storage.removeItem('aura.hintsDone');
});

test('a hint is pending until its gesture is performed, then done forever', () => {
  expect(hintDone(HINT_LIKE)).toBe(false);
  markHintDone(HINT_LIKE);
  expect(hintDone(HINT_LIKE)).toBe(true);
  // Other hints stay pending — done-ness is per gesture.
  expect(hintDone(HINT_KARAOKE)).toBe(false);
});

test('marking notifies subscribers once and is idempotent', () => {
  const seen = [];
  const unsub = subscribeHints(id => seen.push(id));
  markHintDone(HINT_LIKE);
  markHintDone(HINT_LIKE); // already done — no re-notify, no re-write
  expect(seen).toEqual([HINT_LIKE]);
  unsub();
  markHintDone(HINT_KARAOKE);
  expect(seen).toEqual([HINT_LIKE]); // unsubscribed — nothing new lands
  expect(hintDone(HINT_KARAOKE)).toBe(true);
});

test('corrupt storage reads as no hints done, not a crash', () => {
  storage.setItem('aura.hintsDone', 'not json {');
  expect(hintDone(HINT_LIKE)).toBe(false);
  markHintDone(HINT_LIKE); // recovers by rewriting a clean list
  expect(hintDone(HINT_LIKE)).toBe(true);
});
