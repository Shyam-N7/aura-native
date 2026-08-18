import { apiError } from '../src/api/apiError';
import { listLiked } from '../src/api/likes';
import { listPlaylists } from '../src/api/playlists';

// These messages are USER-FACING copy, not developer strings: every screen
// that catches one renders it verbatim next to its own prefix. Liked songs
// showed "Couldn't load — likes fetch failed (500)" — the same thing twice,
// then a status code. likes, playlists and discover never even read the
// server's own `error` field, so there was nothing better to fall back to.

const res = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const nonJson = status => ({
  ok: false,
  status,
  json: async () => {
    throw new SyntaxError('Unexpected token <');
  },
});

test("the server's own message wins", async () => {
  const err = await apiError(res(403, { error: 'this playlist is private' }));
  expect(err.message).toBe('this playlist is private');
  expect(err.status).toBe(403);
});

test('a 5xx reads as the server having trouble, not as a status code', async () => {
  const err = await apiError(res(500, {}), 'your liked songs');
  expect(err.message).not.toMatch(/\d{3}/);
  expect(err.message).toMatch(/server/i);
});

test('a 404 names what is missing', async () => {
  const err = await apiError(res(404, {}), 'this album');
  expect(err.message).toContain('this album');
});

test('a non-JSON body does not escape as a parse error', async () => {
  const err = await apiError(nonJson(502), 'your music');
  expect(err.message).not.toMatch(/JSON|token|Unexpected/i);
  expect(err.status).toBe(502);
});

// The house voice, per docs/CONTEXT.md.
test('messages are lowercase and carry no status code', async () => {
  for (const status of [400, 404, 500, 503]) {
    const err = await apiError(res(status, {}), 'your playlists');
    expect(err.message[0]).toBe(err.message[0].toLowerCase());
    expect(err.message).not.toMatch(/\(\d{3}\)/);
  }
});

// The two that reached a screen verbatim.
describe('the endpoints that had no server message to fall back on', () => {
  afterEach(() => delete global.fetch);

  test('Liked songs', async () => {
    global.fetch = jest.fn(async () => res(500, {}));
    const err = await listLiked().catch(e => e);
    expect(err.message).not.toMatch(/likes fetch failed/);
    expect(err.message).not.toMatch(/\d{3}/);
  });

  test('playlists', async () => {
    global.fetch = jest.fn(async () => res(500, {}));
    const err = await listPlaylists().catch(e => e);
    expect(err.message).not.toMatch(/playlists fetch failed/);
    expect(err.message).not.toMatch(/\d{3}/);
  });
});
