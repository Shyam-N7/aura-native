import {
  API_BASE,
  fetchAuthed,
  fetchMe,
  login,
  getUser,
  isSignedIn,
  clearSession,
} from '../src/lib/auth';
import { storage } from '../src/storage/mmkv';

const jsonRes = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

// Let the fire-and-forget revalidation chain (fetchAuthed → fetchMe) settle.
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

let fetchMock;
beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock;
  clearSession();
});

afterAll(() => {
  delete global.fetch;
});

test('fetchAuthed prefixes API_BASE and injects the bearer token', async () => {
  storage.setItem('aura.authToken', 'jwt-123');
  storage.setItem('aura.authUser', JSON.stringify({ id: 1 }));
  fetchMock.mockResolvedValueOnce(jsonRes(200, {}));

  await fetchAuthed('/api/catalog/featured?limit=5');

  expect(fetchMock).toHaveBeenCalledWith(
    `${API_BASE}/api/catalog/featured?limit=5`,
    expect.objectContaining({
      headers: { Authorization: 'Bearer jwt-123' },
      // The C4 default deadline: every call carries an abort signal unless a
      // caller opts out — asserted here so removing it fails a gate.
      signal: expect.any(AbortSignal),
    }),
  );
});

test('fetchAuthed deadlineMs: 0 opts out of the default abort signal', async () => {
  storage.setItem('aura.authToken', 'jwt-123');
  storage.setItem('aura.authUser', JSON.stringify({ id: 1 }));
  fetchMock.mockResolvedValueOnce(jsonRes(200, {}));

  // The playback-critical exemption (getTrack passes this): no signal at all,
  // so a slow track resolve can never be turned into a failure by C4.
  await fetchAuthed('/api/catalog/track/abc', { deadlineMs: 0 });

  const opts = fetchMock.mock.calls.at(-1)[1];
  expect(opts.signal).toBeUndefined();
  expect(opts.deadlineMs).toBeUndefined(); // stripped, never leaks into fetch
});

test('fetchAuthed keeps caller headers alongside the token', async () => {
  storage.setItem('aura.authToken', 'jwt-123');
  storage.setItem('aura.authUser', JSON.stringify({ id: 1 }));
  fetchMock.mockResolvedValueOnce(jsonRes(200, {}));

  await fetchAuthed('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });

  const [, opts] = fetchMock.mock.calls[0];
  expect(opts.method).toBe('POST');
  expect(opts.headers).toEqual({
    'Content-Type': 'application/json',
    Authorization: 'Bearer jwt-123',
  });
});

test('login sends the native client header and persists token + user', async () => {
  const user = { id: 7, name: 'asha', email: 'a@b.c', hasOnboarded: true };
  fetchMock.mockResolvedValueOnce(jsonRes(200, { token: 'jwt-abc', user }));

  const result = await login('a@b.c', 'pw');

  expect(result).toEqual(user);
  const [url, opts] = fetchMock.mock.calls[0];
  expect(url).toBe(`${API_BASE}/api/auth/login`);
  expect(opts.headers['X-Aura-Client']).toBe('native');
  expect(JSON.parse(opts.body)).toEqual({ email: 'a@b.c', password: 'pw' });
  expect(storage.getItem('aura.authToken')).toBe('jwt-abc');
  expect(getUser()).toEqual(user);
  expect(storage.getItem('aura.hasOnboarded')).toBe('1');
  expect(isSignedIn()).toBe(true);
});

test('login surfaces the device limit instead of throwing', async () => {
  const sessions = [{ id: 's1', device: 'pixel 8' }];
  fetchMock.mockResolvedValueOnce(
    jsonRes(403, { code: 'device_limit', sessions, limit: 3 }),
  );

  const result = await login('a@b.c', 'pw');

  expect(result).toEqual({
    deviceLimit: true,
    code: 'device_limit',
    sessions,
    limit: 3,
  });
  expect(isSignedIn()).toBe(false);
});

test('login rejects with status + code on other errors', async () => {
  fetchMock.mockResolvedValueOnce(
    jsonRes(401, { error: 'wrong password', code: 'bad_credentials' }),
  );

  await expect(login('a@b.c', 'nope')).rejects.toMatchObject({
    message: 'wrong password',
    status: 401,
    code: 'bad_credentials',
  });
});

test('a 401 revalidates via /api/auth/me and clears a dead session', async () => {
  storage.setItem('aura.authToken', 'stale');
  storage.setItem('aura.authUser', JSON.stringify({ id: 1 }));
  fetchMock
    .mockResolvedValueOnce(jsonRes(401, {}))
    .mockResolvedValueOnce(jsonRes(401, {}));

  await fetchAuthed('/api/some/endpoint');
  await flush();

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][0]).toBe(`${API_BASE}/api/auth/me`);
  expect(getUser()).toBe(null);
  expect(isSignedIn()).toBe(false);
});

// Pins the permanent silent sign-out: /me answered 200 with no `user`, so
// persistUser stored the string "undefined" and threw — every later getUser()
// parse failed and the session was gone across restarts.
test('a 200 from /me with no user keeps the cached session', async () => {
  const user = { id: 7, name: 'asha', hasOnboarded: true };
  storage.setItem('aura.authToken', 'jwt-123');
  storage.setItem('aura.authUser', JSON.stringify(user));
  fetchMock.mockResolvedValueOnce(jsonRes(200, { ok: true }));

  await expect(fetchMe()).resolves.toEqual(user);

  expect(getUser()).toEqual(user);
  expect(isSignedIn()).toBe(true);
});

// Same class, at the login call site: a malformed payload must not leave a
// half-written identity behind for the next getUser() to choke on.
test('a login response with no user leaves no broken identity behind', async () => {
  fetchMock.mockResolvedValueOnce(jsonRes(200, { token: 'jwt-abc' }));

  await login('a@b.c', 'pw');

  expect(storage.getItem('aura.authUser')).toBe(null);
  expect(getUser()).toBe(null);
  expect(isSignedIn()).toBe(false);
});

test('a burst of 401s triggers a single session re-check', async () => {
  storage.setItem('aura.authToken', 'stale');
  storage.setItem('aura.authUser', JSON.stringify({ id: 1 }));
  fetchMock.mockResolvedValue(jsonRes(401, {}));

  await Promise.all([
    fetchAuthed('/api/a'),
    fetchAuthed('/api/b'),
    fetchAuthed('/api/c'),
  ]);
  await flush();

  const meCalls = fetchMock.mock.calls.filter(
    ([url]) => url === `${API_BASE}/api/auth/me`,
  );
  expect(meCalls).toHaveLength(1);
});
