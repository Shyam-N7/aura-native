import { scrubBreadcrumb, scrubUrl } from '../src/lib/scrubBreadcrumb';

// Sentry's default integrations record every outgoing fetch URL. Most of ours
// are harmless, but an invite acceptance carries the whole authority to join a
// private playlist IN THE PATH, and a share link carries it in the query.
// Nobody wrote those breadcrumbs, which is exactly why they were unguarded.

test('an invite token is redacted from the path, keeping the shape', () => {
  const cleaned = scrubUrl(
    'https://www.aurafm.live/api/playlists/invite/s3cr3t-token/accept',
  );

  expect(cleaned).not.toContain('s3cr3t-token');
  // Still recognisable as an invite acceptance — that context is the point.
  expect(cleaned).toBe(
    'https://www.aurafm.live/api/playlists/invite/[redacted]/accept',
  );
});

test('a join token is redacted from the query', () => {
  expect(scrubUrl('https://aurafm.live/playlists?join=s3cr3t')).toBe(
    'https://aurafm.live/playlists?join=[redacted]',
  );
});

test('other params on the same url survive', () => {
  const cleaned = scrubUrl('https://aurafm.live/t/abc?at=42&join=s3cr3t&x=1');

  expect(cleaned).toContain('at=42');
  expect(cleaned).toContain('x=1');
  expect(cleaned).not.toContain('s3cr3t');
});

test('ordinary urls are untouched', () => {
  const url = 'https://www.aurafm.live/api/catalog/track/t1';
  expect(scrubUrl(url)).toBe(url);
});

test('the http breadcrumb data.url is scrubbed', () => {
  const out = scrubBreadcrumb({
    category: 'http',
    data: {
      url: 'https://www.aurafm.live/api/playlists/invite/tok/accept',
      method: 'POST',
      status_code: 200,
    },
  });

  expect(out.data.url).not.toContain('/tok/');
  // Everything else on the crumb is left alone.
  expect(out.data.method).toBe('POST');
  expect(out.data.status_code).toBe(200);
});

test('a message carrying a url is scrubbed too', () => {
  const out = scrubBreadcrumb({
    category: 'console',
    message: 'GET https://aurafm.live/playlists?join=s3cr3t failed',
  });

  expect(out.message).not.toContain('s3cr3t');
});

// A thrown scrubber would take out the breadcrumb pipeline; losing the whole
// trail to protect one field is a bad trade.
test('a hostile breadcrumb shape neither throws nor leaks', () => {
  const nasty = {
    get message() {
      throw new Error('boom');
    },
  };

  expect(() => scrubBreadcrumb(nasty)).not.toThrow();
  expect(scrubBreadcrumb(nasty)).toBe(null);
  expect(scrubBreadcrumb(null)).toBe(null);
  expect(scrubBreadcrumb(undefined)).toBe(undefined);
});
