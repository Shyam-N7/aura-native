import fs from 'fs';
import path from 'path';
import { K, SESSION_KEYS } from '../src/storage/keys';
import { storage } from '../src/storage/mmkv';
import { clearSession } from '../src/lib/auth';
import {
  LIKED_SORTS,
  PLAYLIST_SORTS,
} from '../src/components/detail/listSorts';

// `aura.queue` and `aura.position` were retyped as string literals in four
// modules each, and clearSession()'s purge list was eight more literals copied
// from the eight files that own them. A rename in an owning module compiles,
// passes, and goes silently wrong: the readers just see "nothing saved", and
// the sign-out purge just misses a key — which is one account's data left for
// the next one.

const SRC = path.join(__dirname, '..', 'src');

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      return jsFiles(full);
    }
    return /\.jsx?$/.test(e.name) ? [full] : [];
  });
}

test('no module re-types a shared key as a literal', () => {
  const shared = Object.values(K);
  const offenders = [];

  for (const file of jsFiles(SRC)) {
    if (file.endsWith(path.join('storage', 'keys.js'))) {
      continue; // the one place the literals are allowed to exist
    }
    const body = fs.readFileSync(file, 'utf8');
    for (const key of shared) {
      // Quoted occurrences anywhere, comments included. Prose naming a key
      // should name it as `K.position` too — an out-of-date comment pointing
      // at a key that no longer exists is its own small lie, and exempting
      // comments would need this test to parse JS to find them.
      if (body.includes(`'${key}'`) || body.includes(`"${key}"`)) {
        offenders.push(`${path.relative(SRC, file)} → ${key}`);
      }
    }
  }

  expect(offenders).toEqual([]);
});

test('the sign-out purge covers every account-scoped key', () => {
  // Anything added to K is account data unless it is deliberately a device
  // preference. Device prefs are named here so adding one is a decision
  // someone has to write down, not something that slips through.
  const DEVICE_PREFS = [];
  const expected = Object.values(K).filter(k => !DEVICE_PREFS.includes(k));

  expect([...SESSION_KEYS].sort()).toEqual([...expected].sort());
});

test('clearSession actually removes them all', () => {
  SESSION_KEYS.forEach(k => storage.setItem(k, 'x'));

  clearSession();

  expect(SESSION_KEYS.filter(k => storage.getItem(k) !== null)).toEqual([]);
});

test('clearSession leaves device preferences alone', () => {
  // The account-switch reset must not read as "factory reset the phone".
  storage.setItem('aura.theme', 'midnight');
  storage.setItem('aura.ribbonStyle', 'wave');

  clearSession();

  expect(storage.getItem('aura.theme')).toBe('midnight');
  expect(storage.getItem('aura.ribbonStyle')).toBe('wave');
  storage.removeItem('aura.theme');
  storage.removeItem('aura.ribbonStyle');
});

// The two playlist screens persist to ONE key, so their option lists have to
// stay identical — a sort id saved by one and unknown to the other leaves the
// slider with no segment to sit on and the rows in source order, on a screen
// that claims to be sorted.
test('both playlist screens read the same sort list', () => {
  const files = [
    'screens/PlaylistScreen.jsx',
    'screens/CatalogPlaylistScreen.jsx',
  ].map(f => fs.readFileSync(path.join(SRC, f), 'utf8'));

  for (const body of files) {
    expect(body).toContain('PLAYLIST_SORTS');
    expect(body).not.toMatch(/const SORTS = \[/);
  }
});

test('liked keeps its own list — default means recency there', () => {
  expect(LIKED_SORTS.find(s => s.id === 'default').label).toBe('recent');
  expect(PLAYLIST_SORTS.find(s => s.id === 'default').label).toBe('in order');
  // Same ids either way, so a row-sorting switch handles both.
  expect(LIKED_SORTS.map(s => s.id)).toEqual(PLAYLIST_SORTS.map(s => s.id));
});
