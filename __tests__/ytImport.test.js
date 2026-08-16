import {
  previewLink,
  startImport,
  pollImport,
  refreshPlaylist,
  getYtLink,
  getFeatures,
  invalidateYtLinks,
  isLive,
} from '../src/api/ytImport';
import { LINK_ERRORS, IMPORT_ERRORS, copyForCode, isRetryable } from '../src/lib/ytImportCopy';
import { fetchAuthed } from '../src/lib/auth';

jest.mock('../src/lib/auth', () => ({
  API_BASE: 'https://www.aurafm.live',
  fetchAuthed: jest.fn(),
}));

const ok = body => ({ ok: true, status: 200, json: async () => body });
const bad = (status, body) => ({ ok: false, status, json: async () => body });

// A fetch that never answers but DOES honour its signal, which is what a real
// socket does — the point of the deadline is that nothing else will end it.
const hangs = () => (path, opts) =>
  new Promise((_, reject) => {
    opts.signal.addEventListener('abort', () =>
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })),
    );
  });

beforeEach(() => {
  jest.clearAllMocks();
  invalidateYtLinks();
});

test('a link error keeps its code, so the copy pack can answer it', async () => {
  fetchAuthed.mockResolvedValue(
    bad(400, { error: 'single video', code: 'YT_VIDEO_ONLY' }),
  );
  await expect(previewLink('https://youtu.be/x')).rejects.toMatchObject({
    code: 'YT_VIDEO_ONLY',
    status: 400,
  });
  // And the code — not the server's prose — is what the user reads.
  expect(copyForCode('YT_VIDEO_ONLY', 'single video').title).toBe(
    "that's a single video",
  );
});

test('startImport opts out of the 15s default — the server drains for 20s inside the request', async () => {
  fetchAuthed.mockResolvedValue(ok({ id: 'yti_a', status: 'matching' }));
  await startImport('https://youtube.com/playlist?list=PL1');
  const [, opts] = fetchAuthed.mock.calls[0];
  expect(opts.deadlineMs).toBe(45000);
  expect(opts.signal).toBeUndefined();
});

test('refreshPlaylist opts out too, and drops the link cache', async () => {
  fetchAuthed.mockResolvedValueOnce(ok({ links: [{ playlist_id: 'p1' }] }));
  await getYtLink('p1');
  fetchAuthed.mockResolvedValueOnce(ok({ changed: false }));
  await refreshPlaylist('p1');
  expect(fetchAuthed.mock.calls[1][1].deadlineMs).toBe(45000);

  // The cache is gone, so the next lookup asks again.
  fetchAuthed.mockResolvedValueOnce(ok({ links: [] }));
  await getYtLink('p1');
  expect(fetchAuthed).toHaveBeenCalledTimes(3);
});

test('pollImport always carries a signal, even when the caller gives none', async () => {
  fetchAuthed.mockResolvedValue(ok({ id: 'yti_a', status: 'done' }));
  await pollImport('yti_a');
  expect(fetchAuthed.mock.calls[0][1].signal).toBeDefined();
});

// The single most important assertion in the feature. fetchAuthed's deadline is
// disabled the moment a caller passes a signal, and RN's fetch has none of its
// own — so without this module's own timer a hung poll never settles, the hook
// never schedules another tick, and the import dies with the bar still on screen.
test('a poll that never answers times out as a RETRYABLE TimeoutError, not an AbortError', async () => {
  jest.useFakeTimers();
  fetchAuthed.mockImplementation(hangs());
  const settled = pollImport('yti_a').catch(e => e);
  jest.advanceTimersByTime(30000);
  expect(await settled).toMatchObject({
    name: 'TimeoutError',
    code: 'YT_TIMEOUT',
  });
  // AbortError would read to the hook as "we stopped on purpose" and stop the
  // loop. YT_TIMEOUT is retryable, so the next tick is the next attempt.
  expect(isRetryable('YT_TIMEOUT')).toBe(true);
  jest.useRealTimers();
});

test("a caller's own abort still surfaces as AbortError", async () => {
  jest.useFakeTimers();
  fetchAuthed.mockImplementation(hangs());
  const ctl = new AbortController();
  const settled = pollImport('yti_a', { signal: ctl.signal }).catch(e => e);
  ctl.abort();
  expect(await settled).toMatchObject({ name: 'AbortError' });
  jest.useRealTimers();
});

test('getYtLink matches on the SQL row shape and asks once per session', async () => {
  fetchAuthed.mockResolvedValue(
    ok({ links: [{ playlist_id: 'p1', youtube_playlist_id: 'PL1' }] }),
  );
  // snake_case: these rows come straight from SQL, unlike every other payload.
  expect(await getYtLink('p1')).toMatchObject({ playlist_id: 'p1' });
  expect(await getYtLink('p2')).toBeNull();
  expect(fetchAuthed).toHaveBeenCalledTimes(1);
});

test('a failed link lookup is not cached, and hides the button rather than throwing', async () => {
  fetchAuthed.mockResolvedValueOnce(bad(500, {}));
  expect(await getYtLink('p1')).toBeNull();
  fetchAuthed.mockResolvedValueOnce(ok({ links: [{ playlist_id: 'p1' }] }));
  expect(await getYtLink('p1')).toMatchObject({ playlist_id: 'p1' });
});

test('getFeatures answers {} on failure — a button that 503s is worse than no button', async () => {
  fetchAuthed.mockRejectedValueOnce(new Error('offline'));
  await expect(getFeatures()).resolves.toEqual({});
  // And the failure is not cached, so the next screen gets a real answer.
  fetchAuthed.mockResolvedValueOnce(ok({ youtubeImport: true }));
  await expect(getFeatures()).resolves.toEqual({ youtubeImport: true });
});

test('isLive covers exactly the statuses the server still works on', () => {
  expect(['queued', 'fetching', 'matching'].every(isLive)).toBe(true);
  expect(['done', 'failed', 'review'].some(isLive)).toBe(false);
});

// ── The copy pack is the contract ───────────────────────────────────

test('every error code has copy, and an unknown one falls back to the server', () => {
  const all = { ...LINK_ERRORS, ...IMPORT_ERRORS };
  for (const [code, entry] of Object.entries(all)) {
    expect(typeof entry.title).toBe('string');
    expect(entry.title.length).toBeGreaterThan(0);
    // The native voice, guarded so a later sync from web cannot quietly
    // re-case the pack back to sentence case.
    expect(`${code}: ${entry.title}`).toMatch(
      new RegExp(`^${code}: [^A-Z]`),
    );
  }
  expect(copyForCode('YT_FROM_THE_FUTURE', 'server said this')).toMatchObject({
    title: 'server said this',
    retryable: true,
  });
});

test('retry is offered only where retrying can change the answer', () => {
  expect(isRetryable('YT_UPSTREAM')).toBe(true);
  // A retry button on an exhausted daily quota is a lie the user pays for.
  expect(isRetryable('YT_QUOTA')).toBe(false);
  expect(isRetryable('YT_TOO_LARGE')).toBe(false);
  // Link errors are not import failures and never carry a retry.
  expect(isRetryable('YT_VIDEO_ONLY')).toBe(false);
});
