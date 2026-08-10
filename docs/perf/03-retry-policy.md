# AURA Native — Playback Retry Policy (Phase 3)

*Design principle: the existing recovery (`engine.js:549` — quality ladder → one URL
refetch → skip) has the right LADDER; what it lacks is timing discipline and error
classes. This layers policy onto that hook rather than rebuilding it. ExoPlayer's own
`LoadErrorHandlingPolicy` (native defaults: ~3 load retries with backoff) stays stock —
customizing it means patching kotlin-audio for marginal gain; the JS layer is where our
context (fresh URLs, queue, connectivity) lives.*

## Error taxonomy → policy

| Class | Signal | Policy |
|---|---|---|
| Expired/forbidden URL | HTTP 403/410 on segment, or error shortly after a stale-cached URL | **Re-resolve first** (bypass track cache), retry immediately, position preserved. Never counts against backoff budget the first time. |
| Transient network / 5xx / timeout | ExoPlayer source error, 5xx | Retry same URL: **0 s → 1 s → 3 s → 8 s, ±30 % jitter, hard cap 20 s** (see the attempt-cap note below), then next rung. |
> **Unresolved: 4 attempts or 6?** This table said "hard cap 4 attempts"; the
> shipped `MAX_ATTEMPTS` is **6** (`src/lib/retryPolicy.js:47`). Nothing records
> which was intended — `__tests__/retryPolicy.test.js:64` only pins `> 2`.
> In practice the difference is mostly moot: `SCHEDULE` has four entries and
> clamps beyond them, so attempts 5 and 6 reuse the 8 s rung, and the cumulative
> elapsed time crosses `MAX_RECOVERY_MS = 20000` before either fires. Flagged
> rather than silently reconciled — editing the doc to match the code would
> enshrine whichever one is the mistake.

| Hard 4xx (404/451) | HTTP 4xx ≠ 403 | No retry of that URL. One re-resolve; if the re-resolved track 4xxs again → **skip**. |
| Decoder/source malformed | ExoPlayer renderer/parsing error | One reload (same position); then quality-ladder down; then skip. |
| Offline | fetch to own API also failing / no route | Don't burn attempts blind. Hold paused-with-intent; a **connectivity probe every 5 s** (lightweight HEAD to our origin) gates the next attempt. (No new dependency; NetInfo can replace the probe later.) |

## Invariants
- **Position is sacred:** every path resumes via `getProgress()` → `loadAndResume`
  (already true today; stays the acceptance test).
- **User action resets policy:** an explicit play/next/pick clears backoff state for
  that track (`resetRecoveryFor` exists).
- **Ladder order:** same-URL backoff → quality-rung down → URL re-resolve → cached-media
  resume (SimpleCache serves what it has) → skip-to-next. Skip is last because a
  screen-off session must never fall silent on a recoverable blip — and never loops:
  a skipped track is marked failed for the session.

## User-visible behavior
- Recoveries under ~2 s: nothing shown — the gap is the message.
- Beyond one backoff round: existing toast pattern ("connection wobbled — retrying").
- Final give-up (skip): the existing "couldn't play that one" toast; session continues.
- Every attempt/outcome emits a `crumb('recovery', …)` so the fleet's actual error-class
  mix drives future tuning — measure, then tighten.

## Why not exponential-from-zero everywhere
First retry at 0 s because transient CDN hiccups dominate and a blank 1 s pause is
audible; jitter because synchronized retries from many clients against one origin is a
self-inflicted stampede; the 20 s ceiling because beyond it the honest states are
"offline-waiting" (connectivity-gated) or "skip", not more waiting.
