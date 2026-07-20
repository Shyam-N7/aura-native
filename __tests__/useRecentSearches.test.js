import {
  pushRecentSearch,
  clearRecentSearches,
} from '../src/hooks/useRecentSearches';
import { storage } from '../src/storage/mmkv';

const stored = () => JSON.parse(storage.getItem('aura.recentSearches'));

beforeEach(() => clearRecentSearches());

test('a committed longer query supersedes the partial typings that led to it', () => {
  pushRecentSearch('mar');
  pushRecentSearch('marand');
  pushRecentSearch('marandhu poche');
  expect(stored()).toEqual(['marandhu poche']);

  // Unrelated queries are untouched, newest first.
  pushRecentSearch('arijit');
  expect(stored()).toEqual(['arijit', 'marandhu poche']);

  // Case-insensitive: extending sweeps regardless of typed case.
  pushRecentSearch('Arijit Singh');
  expect(stored()).toEqual(['Arijit Singh', 'marandhu poche']);
});
