import { useCallback, useEffect, useRef, useState } from 'react';
import { pollImport, isLive, invalidateYtLinks } from '../api/ytImport';

// Polling an import job.
//
// Ported from web src/hooks/useImportJob.js. The unusual thing here, and the
// reason this is a hook rather than three lines inside the screen: GET /:jobId
// is not a read. There is no background worker on the deployment, so each poll
// performs a slice of the matching work on the server. That inverts the normal
// cost model —
//
//   * not polling doesn't just stale the UI, it STOPS the import (until the
//     daily cron picks it up),
//   * and polling a job nobody is watching burns real upstream budget.
//
// So the lifecycle has to be exact: stop on a terminal status, stop on unmount,
// and never leave a timer behind.

const FAST_MS = 2000;
const SLOW_MS = 5000;
// When the last poll answered workRemaining: true, the server's drain ran out
// of budget with items still pending — it is explicitly waiting to be driven
// again. Chasing at 300ms turns "15s of work, 2s of silence" into a nearly
// continuous drain; the courtesy gaps below are for the idle case only. An
// un-upgraded server simply never sets the field, and the cadence is exactly
// what it was. Chase ticks still count toward MAX_TICKS — the stall guard's
// budget is ticks, not minutes, and a server that keeps asking to be chased
// while making no progress is precisely what the guard exists to catch.
const CHASE_MS = 300;
// After this many polls we assume something is wrong rather than slow. A 30-track
// import finishes in one or two ticks; 20 is far past "slow" and into "stuck",
// and a screen left open on a stuck job should not spin at 2s forever.
const SLOW_AFTER = 20;
// And after THIS many, stop asking and say so. Native-only: a web tab that goes
// stale is eventually frozen or closed by the browser, but this JS context
// survives backgrounding for hours (playback keeps the process warm), so a job
// that is never going to finish would poll — and bill upstream quota — for as
// long as the app lives. ~40s of fast ticks plus 15 minutes of slow ones.
const MAX_TICKS = 200;

export function useImportJob(initialJob) {
  const [job, setJob] = useState(initialJob ?? null);
  const [error, setError] = useState(null);
  // Hit the tick cap: the job is still live but has stopped moving. Not an
  // error — the work continues server-side — so it gets its own state and its
  // own "keep checking" action rather than being dressed as a failure.
  const [stalled, setStalled] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Refs, not state: the polling loop reads these and must not be a reason to
  // re-render or to re-create itself.
  const timerRef = useRef(null);
  // A BARE seed — a job with an id but no counts — is a screen arriving
  // mid-import knowing nothing (PlaylistScreen seeded from the handoff
  // param). It polls IMMEDIATELY: there is no fresher data to wait out, and
  // the first FAST_MS of a streaming screen would otherwise be a blank
  // footer. A full job (from the POST, or any later poll) keeps the 2s first
  // delay — its data is seconds old at most. Render-time ref write, read at
  // effect time: deliberate, so `job` need not be an effect dependency.
  const bareRef = useRef(false);
  bareRef.current = job != null && job.counts == null;
  const abortRef = useRef(null);
  const tickRef = useRef(0);
  const stoppedRef = useRef(false);
  // Whether the LAST response asked to be chased (see CHASE_MS). A ref for the
  // same reason as the others: the loop reads it, renders must not.
  const chaseRef = useRef(false);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const resume = useCallback(() => {
    tickRef.current = 0;
    setStalled(false);
    setAttempt(n => n + 1);
  }, []);

  const jobId = job?.id ?? null;
  const live = isLive(job?.status);

  // Deliberately NOT gated on useNavFocused()/AppState, unlike the rev-poll at
  // PlaylistScreen.jsx:256-283. That gate is right there and wrong here: that
  // poll is a pure read, so a parked screen that keeps reading is pure waste.
  // This one is the worker. Gating it on focus would stop the user's import the
  // moment they opened another screen — exactly what COPY.progress.safeToLeave
  // promises will not happen — and the recovery is a cron that runs once a day.
  // The unbounded-invisible-loop concern that motivates the house rule is
  // covered instead by the terminal status and by MAX_TICKS: this loop ends.
  useEffect(() => {
    if (!jobId || !live || stalled) {
      return undefined;
    }
    stoppedRef.current = false;

    const tick = async () => {
      if (stoppedRef.current) {
        return;
      }
      // Set on every path that must NOT schedule another tick: terminal,
      // aborted, stopped. Anything else — including an unexpected throw — falls
      // through to the reschedule in `finally`, because a poll that stops
      // rescheduling is an import that dies silently with the bar still moving.
      let done = false;
      const ctl = new AbortController();
      abortRef.current = ctl;
      try {
        const next = await pollImport(jobId, { signal: ctl.signal });
        if (stoppedRef.current) {
          done = true;
          return;
        }
        chaseRef.current = next.workRemaining === true;
        setJob(next);
        setError(null);
        // Terminal: let the effect tear itself down rather than scheduling
        // another tick against a job that will never change again.
        if (!isLive(next.status)) {
          // finishJob writes the yt_playlist_links row at the END of the work,
          // not at enqueue — so THIS is the moment a freshly imported playlist
          // becomes refreshable. Invalidating any earlier would just re-cache
          // the absence that was true a second ago, and the refresh button
          // would not appear until the next session.
          invalidateYtLinks();
          done = true;
        }
      } catch (err) {
        if (err.name === 'AbortError' || stoppedRef.current) {
          done = true;
          return;
        }
        // A failed poll is not a failed import — the job is still on the server
        // and the cron will finish it. Surface it, keep polling; the next tick
        // is also the next attempt at the work itself. A client-side timeout
        // arrives here as TimeoutError (api/ytImport.js) precisely so that it
        // lands on this path instead of reading as a deliberate abort. Idle
        // cadence from here: a chase gap must not survive into an error loop.
        chaseRef.current = false;
        setError(err);
      } finally {
        if (!done && !stoppedRef.current) {
          tickRef.current += 1;
          if (tickRef.current >= MAX_TICKS) {
            stoppedRef.current = true;
            setStalled(true);
          } else {
            timerRef.current = setTimeout(
              tick,
              chaseRef.current
                ? CHASE_MS
                : tickRef.current >= SLOW_AFTER
                ? SLOW_MS
                : FAST_MS,
            );
          }
        }
      }
    };

    timerRef.current = setTimeout(tick, bareRef.current ? 0 : FAST_MS);
    // Covers unmount AND the transition to a terminal status, because `live` is
    // in the dependency list. Both must stop the timer; only one of them is
    // obvious, and the other is the one that would leak.
    return stop;
  }, [jobId, live, stalled, attempt, stop]);

  return { job, setJob, error, stop, live, stalled, resume };
}

/**
 * The counts a progress bar needs, derived rather than stored.
 *
 * `matching` is how many videos are still unresolved, so done = total - matching.
 * Clamped because total is written at the end of the fetch phase and the two can
 * disagree for one tick — a progress bar that reads "31 of 30" for a frame is a
 * small thing, but it is the kind of small thing users notice and don't trust.
 */
export function progressOf(job) {
  const total = job?.counts?.total ?? 0;
  const matching = job?.counts?.matching ?? 0;
  const done = Math.max(0, Math.min(total, total - matching));
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}
