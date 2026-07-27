import {
  clearTrackCache,
  getTrack,
  trackCacheAge,
} from '../src/api/catalog';
import { fetchAuthed } from '../src/lib/auth';

// The resolved-track cache (docs/perf/02 layer 1): every play used to pay a
// catalog round-trip; these pin the TTL/bypass/LRU rules that removed it.

jest.mock('../src/lib/auth', () => ({
  fetchAuthed: jest.fn(),
}));

const okResponse = track => ({
  ok: true,
  json: () => Promise.resolve(track),
});

describe('getTrack cache', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    clearTrackCache();
    fetchAuthed.mockReset();
  });

  it('serves a fresh hit without touching the network', async () => {
    fetchAuthed.mockResolvedValueOnce(okResponse({ id: 'a', streamUrl: 'u1' }));
    await getTrack('a');
    const again = await getTrack('a');
    expect(again.streamUrl).toBe('u1');
    expect(fetchAuthed).toHaveBeenCalledTimes(1);
  });

  it('fresh:true bypasses AND refills the cache', async () => {
    fetchAuthed.mockResolvedValueOnce(okResponse({ id: 'a', streamUrl: 'u1' }));
    await getTrack('a');
    fetchAuthed.mockResolvedValueOnce(okResponse({ id: 'a', streamUrl: 'u2' }));
    const fresh = await getTrack('a', { fresh: true });
    expect(fresh.streamUrl).toBe('u2');
    // The refill is what the recovery rung depends on: the NEXT plain call
    // must see the new URL, not the expired one it just failed on.
    const after = await getTrack('a');
    expect(after.streamUrl).toBe('u2');
    expect(fetchAuthed).toHaveBeenCalledTimes(2);
  });

  it('expires by TTL', async () => {
    const t0 = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(t0);
    fetchAuthed.mockResolvedValueOnce(okResponse({ id: 'a', streamUrl: 'u1' }));
    await getTrack('a');
    expect(trackCacheAge('a')).toBe(0);
    jest.spyOn(Date, 'now').mockReturnValue(t0 + 16 * 60 * 1000);
    fetchAuthed.mockResolvedValueOnce(okResponse({ id: 'a', streamUrl: 'u2' }));
    const after = await getTrack('a');
    expect(after.streamUrl).toBe('u2');
    expect(fetchAuthed).toHaveBeenCalledTimes(2);
  });

  it('never caches an error and reports Infinity age when absent', async () => {
    fetchAuthed.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'nope' }),
    });
    await expect(getTrack('missing')).rejects.toThrow('nope');
    expect(trackCacheAge('missing')).toBe(Infinity);
  });
});
