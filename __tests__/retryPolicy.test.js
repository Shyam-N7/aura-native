import {
  MAX_ATTEMPTS,
  MAX_RECOVERY_MS,
  classifyPlaybackError,
  retryDelayMs,
} from '../src/lib/retryPolicy';

// docs/perf/03 — the error classes and timing rules the recovery ladder
// runs on. Pure functions; these pin the policy, engine.js supplies the player.

describe('classifyPlaybackError', () => {
  it('routes http statuses by class, not blanket-retries', () => {
    const http = msg => ({ code: 'android-io-bad-http-status', message: msg });
    expect(classifyPlaybackError(http('Response code: 403'))).toBe('expired');
    expect(classifyPlaybackError(http('Response code: 410'))).toBe('expired');
    expect(classifyPlaybackError(http('Response code: 404'))).toBe('gone');
    expect(classifyPlaybackError(http('Response code: 503'))).toBe('network');
  });

  it('treats connection failures and timeouts as network', () => {
    expect(
      classifyPlaybackError({ code: 'android-io-network-connection-failed' }),
    ).toBe('network');
    expect(
      classifyPlaybackError({ code: 'android-io-network-connection-timeout' }),
    ).toBe('network');
  });

  it('maps missing files, parser and decoder failures', () => {
    expect(classifyPlaybackError({ code: 'android-io-file-not-found' })).toBe(
      'gone',
    );
    expect(
      classifyPlaybackError({ code: 'android-parsing-container-malformed' }),
    ).toBe('malformed');
    expect(
      classifyPlaybackError({ code: 'android-decoder-init-failed' }),
    ).toBe('malformed');
  });

  it('never throws on garbage', () => {
    expect(classifyPlaybackError(null)).toBe('unknown');
    expect(classifyPlaybackError({})).toBe('unknown');
  });
});

describe('retryDelayMs', () => {
  it('first retry is instant', () => {
    expect(retryDelayMs(0, 0.5)).toBe(0);
  });

  it('follows the jittered schedule within ±30%', () => {
    expect(retryDelayMs(1, 0)).toBe(700); // 1s floor
    expect(retryDelayMs(1, 1)).toBe(1300); // 1s ceiling
    expect(retryDelayMs(2, 0.5)).toBe(3000); // 3s midpoint
    expect(retryDelayMs(3, 0.5)).toBe(8000); // 8s midpoint
  });

  it('clamps beyond the schedule instead of growing unbounded', () => {
    expect(retryDelayMs(50, 0.5)).toBe(8000);
  });

  it('ceilings are sane', () => {
    expect(MAX_ATTEMPTS).toBeGreaterThan(2);
    expect(MAX_RECOVERY_MS).toBeLessThanOrEqual(30000);
  });
});
