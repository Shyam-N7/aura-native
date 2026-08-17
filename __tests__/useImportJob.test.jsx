import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { useImportJob, progressOf } from '../src/hooks/useImportJob';
import { pollImport, invalidateYtLinks } from '../src/api/ytImport';

jest.mock('../src/api/ytImport', () => ({
  pollImport: jest.fn(),
  invalidateYtLinks: jest.fn(),
  // The real predicate — the loop's stop condition is the thing under test and
  // must not be stubbed into agreement.
  isLive: status => ['queued', 'fetching', 'matching'].includes(status),
}));

const LIVE = { id: 'yti_a', status: 'matching', counts: { total: 30, matching: 18 } };
const DONE = { id: 'yti_a', status: 'done', counts: { total: 30, matching: 0 } };

let seen;
function Probe({ initial }) {
  seen = useImportJob(initial);
  return <Text>{seen.job?.status ?? 'none'}</Text>;
}

async function mount(initial) {
  let tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<Probe initial={initial} />);
  });
  return tree;
}

// Every advance has to flush the awaited poll inside the same act, or the
// reschedule lands after the assertion.
const tickBy = ms =>
  ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(ms);
  });

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

test('the first poll waits 2s, and does not fire early', async () => {
  pollImport.mockResolvedValue(LIVE);
  await mount(LIVE);
  await tickBy(1999);
  expect(pollImport).not.toHaveBeenCalled();
  await tickBy(1);
  expect(pollImport).toHaveBeenCalledTimes(1);
});

test('chases at 300ms while the server says its drain ran out of budget', async () => {
  // workRemaining: true = the drain hit its budget with items pending — the
  // server is explicitly waiting to be driven again. The courtesy gap is for
  // the idle case; holding it here would leave 15s of work per 17s of clock.
  pollImport.mockResolvedValue({ ...LIVE, workRemaining: true });
  await mount(LIVE);
  await tickBy(2000);
  expect(pollImport).toHaveBeenCalledTimes(1);
  await tickBy(300);
  expect(pollImport).toHaveBeenCalledTimes(2);

  // Flag drops (slice finished, or an un-upgraded server): idle cadence again.
  pollImport.mockResolvedValue(LIVE);
  await tickBy(300);
  expect(pollImport).toHaveBeenCalledTimes(3);
  await tickBy(300);
  expect(pollImport).toHaveBeenCalledTimes(3);
  await tickBy(1700);
  expect(pollImport).toHaveBeenCalledTimes(4);
});

test('a failed poll retries on the idle gap, never a 300ms hammer', async () => {
  pollImport.mockResolvedValueOnce({ ...LIVE, workRemaining: true });
  pollImport.mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'TimeoutError' }));
  pollImport.mockResolvedValue(LIVE);
  await mount(LIVE);
  await tickBy(2000);
  await tickBy(300);
  expect(pollImport).toHaveBeenCalledTimes(2);
  await tickBy(300);
  expect(pollImport).toHaveBeenCalledTimes(2);
  await tickBy(1700);
  expect(pollImport).toHaveBeenCalledTimes(3);
});

test('after 20 ticks it steps down to 5s — stuck, not slow', async () => {
  pollImport.mockResolvedValue(LIVE);
  await mount(LIVE);
  for (let i = 0; i < 20; i++) {
    await tickBy(2000);
  }
  expect(pollImport).toHaveBeenCalledTimes(20);
  await tickBy(2000);
  expect(pollImport).toHaveBeenCalledTimes(20);
  await tickBy(3000);
  expect(pollImport).toHaveBeenCalledTimes(21);
});

test('a terminal status stops the loop and makes the playlist refreshable', async () => {
  pollImport.mockResolvedValue(DONE);
  await mount(LIVE);
  await tickBy(2000);
  expect(seen.job.status).toBe('done');
  // finishJob writes the link row at the END of the work, so this is the moment
  // a freshly imported playlist becomes refreshable — earlier would just
  // re-cache the absence that was true a second ago.
  expect(invalidateYtLinks).toHaveBeenCalledTimes(1);
  await tickBy(60000);
  expect(pollImport).toHaveBeenCalledTimes(1);
});

// The reason the reschedule lives in `finally`. A failed poll is not a failed
// import: the job is still on the server, and the next tick is also the next
// attempt at the work itself.
test('a failed poll keeps polling, and keeps the job it already had', async () => {
  pollImport
    .mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'YT_UPSTREAM' }))
    .mockResolvedValue(DONE);
  await mount(LIVE);
  await tickBy(2000);
  expect(seen.error).toMatchObject({ code: 'YT_UPSTREAM' });
  expect(seen.job.status).toBe('matching');
  await tickBy(2000);
  expect(pollImport).toHaveBeenCalledTimes(2);
  expect(seen.job.status).toBe('done');
});

test('a client-side timeout retries — it is not read as a deliberate abort', async () => {
  pollImport
    .mockRejectedValueOnce(
      Object.assign(new Error('slow'), { name: 'TimeoutError', code: 'YT_TIMEOUT' }),
    )
    .mockResolvedValue(LIVE);
  await mount(LIVE);
  await tickBy(2000);
  await tickBy(2000);
  expect(pollImport).toHaveBeenCalledTimes(2);
});

test('an AbortError does not reschedule — that one really was us stopping', async () => {
  pollImport.mockRejectedValue(
    Object.assign(new Error('Aborted'), { name: 'AbortError' }),
  );
  await mount(LIVE);
  await tickBy(2000);
  await tickBy(60000);
  expect(pollImport).toHaveBeenCalledTimes(1);
});

test('unmount leaves no timer behind', async () => {
  pollImport.mockResolvedValue(LIVE);
  const tree = await mount(LIVE);
  await tickBy(2000);
  expect(pollImport).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(async () => tree.unmount());
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(60000);
  });
  expect(pollImport).toHaveBeenCalledTimes(1);
});

// Native-only. This JS context survives backgrounding for hours (playback keeps
// the process warm), so a job that will never finish would poll — and bill
// upstream quota — for as long as the app lives.
test('a job that never finishes gives up at the cap, and can be resumed', async () => {
  pollImport.mockResolvedValue(LIVE);
  await mount(LIVE);
  for (let i = 0; i < 20; i++) {
    await tickBy(2000);
  }
  for (let i = 0; i < 200; i++) {
    await tickBy(5000);
  }
  expect(seen.stalled).toBe(true);
  const capped = pollImport.mock.calls.length;
  expect(capped).toBeLessThan(220);
  await tickBy(60000);
  expect(pollImport).toHaveBeenCalledTimes(capped);

  await ReactTestRenderer.act(async () => seen.resume());
  await tickBy(2000);
  expect(pollImport).toHaveBeenCalledTimes(capped + 1);
});

test('progress never reads "31 of 30"', () => {
  expect(progressOf({ counts: { total: 30, matching: 18 } })).toEqual({
    done: 12,
    total: 30,
    pct: 40,
  });
  // total is written at the end of the fetch phase; the two can disagree for a
  // tick, and a bar that overshoots is the kind of small thing users notice.
  expect(progressOf({ counts: { total: 30, matching: -1 } }).done).toBe(30);
  expect(progressOf(null)).toEqual({ done: 0, total: 0, pct: 0 });
});
