# Phase 7 — attribution

**Partial.** Attribution requires profile evidence, and most of Phase 6's rows are blank (9 of 21). This covers only what was actually measured. Everything else is stated as unattributed rather than guessed at.

**Device labels are load-bearing.** A = RMX3371 (SM8250, 5.4 GiB, Android 14, ColorOS 14). B = OnePlus 6T (sdm845, 7.5 GiB, Android 11, OxygenOS 11). **Both flagship-class. No claim here extends to a 3 GB device.**

---

## Client

### Missed budget 1 — frame time on a long list scroll

**Measured (B):** p50 16 ms, p90 31 ms, p95 48 ms, p99 65 ms; 645/1290 frames janky (50.0%) over a 117-row scroll. Budget 16.7 ms.

**Attribution: I do not believe the headline, and the counters are why.**

The same `gfxinfo` dump reports `Number Missed Vsync: 0`, `Number Slow UI thread: 0`, `Number Slow bitmap uploads: 0`, and GPU percentiles of 6 / 10 / 10 / 11 ms. Those are healthy. A genuine 50% jank rate driven by rendering would show up in at least one of them.

What it does report is **`Number High input latency: 1290` — every single frame.** That is the signature of `adb shell input swipe`: injected events carry timestamps the framework reads as arriving late, so every frame is classified janky on input latency alone regardless of how fast it rendered.

**Verdict: measurement artefact, not a defect.** The rendering evidence contradicts the jank number. **Confirm with a real finger** — the same capture driven by a human hand. Until then this row should not drive any optimisation, and Phase 8 must not draw from it.

### Unattributed — ~78 MB retained after leaving a long list

**Measured (A):** opening a 289-track playlist costs +37 MB (284 → 321 peak). Scrolling it end to end reaches 384 MB. Leaving it returns **views to their exact pre-open count (539 → 1134 → 539)** but leaves PSS at **362 MB**. So ~78 MB outlives the view tree.

**What it is not** — both eliminated by reading the code, not by guessing:

- **Not the view tree.** Views recycled exactly. Fabric released what it mounted.
- **Not an unbounded bitmap cache**, which was my first hypothesis and was wrong. `MainApplication.kt` caps Fresco's decoded-bitmap cache at 24 MB and Coil's at 8 MB, and `onTrimMemory` clears both from `TRIM_MEMORY_RUNNING_LOW` up. 32 MB of bounded cache cannot hold 78 MB.

**Still unattributed.** The measurement is solid and repeatable; the cause is not identified. **What would settle it:** `am dumpheap` before and after the scroll, diffed — that names the retaining class directly. I did not run it. A `dumpsys meminfo` category diff across the same window would narrow it faster but less precisely.

### Confirmed fine — background playback memory

**Measured (B):** seven continuous minutes, screen verified `OFF`/`Dozing` every sample, audio confirmed rendering. PSS oscillates 241–295 MB and plateaus at ~280 MB. Category buckets flat throughout: EGL mtrack pinned at 28 MB, Gfx dev 16 MB, Views 288, Activities 1, AppContexts 8.

**This row exists because I got it wrong first.** I reported a 70 MB/min unbounded leak from a run that never verified its screen was off. It did not reproduce. See `reports/08-spotted.md` SP1. **Background playback does not leak.**

### Cold start — the ROM, not the silicon

**Measured:** A 502 ms median (907/502/453, spread 454 ms). B **289 ms** median (291/287/289, spread 4 ms).

The 2018 SoC beats the 2021 SoC by 42%, and does it with a spread two orders of magnitude tighter. Silicon cannot explain that; scheduling contention can.

**Attribution: ColorOS, `(inferred)`.** I did not profile the boot path on either device, so this is an inference from the shape of the numbers — B's near-zero variance says nothing is competing for CPU at launch, A's 454 ms spread says something is. **Confirm with** `perfetto` traces of the first 1.5 s on both devices, or more cheaply by reading the `boot-timing` context already being shipped to Sentry by `src/lib/perfMarks.js` on every cold start at `SAMPLE = 1.0` — that instrumentation exists and its numbers have still never been read.

**Consequence for the work:** cold-start optimisation should be validated on ColorOS specifically. Tuning against B would be tuning against the easier case.

### Not measured — JS vs UI thread, bridge traffic, re-render counts

The brief asks which thread is actually blocked, how much JSI traffic there is, and what triggers re-renders. **None of it was measured.** No Hermes sampling profile was captured, no React Profiler run, no systrace.

What I have instead is a static reading from Phase 3, and it should be treated as a hypothesis, not attribution: `native/src/screens/PlaylistScreen.jsx:451` defines `renderRow` inline so it changes identity every render, `:485` passes an inline `keyExtractor`, and `DetailRow` is not memoized — `React.memo` appears at only 3 sites in all of `native/src/`. That *predicts* full re-renders of mounted rows on any parent state change. It has not been observed.

**The drag path is confirmed correct by reading**, and this one I am confident in: `QueueSheet.jsx` runs `onStart`/`onUpdate`/`onEnd` entirely as worklets, with `runOnJS` at exactly four points — pickup haptics, the drag flag (twice), and the commit. It does not cross back to JS per frame.

---

## Server

**Nothing was measured.** All three server rows in Phase 6 are blank, and they are blank because I have no production access: no Neon read for query timing or payload size at real table sizes, no Vercel dashboard for cold-start rate or function duration.

Attribution therefore cannot be done. What the code says, carried from Phase 3 as **suspicion, not attribution**:

- **`listPlaylists` aggregates two whole tables per call.** `web/server/playlists.js:75-93` joins against `SELECT playlist_id, COUNT(*) FROM playlist_tracks GROUP BY playlist_id` with no user predicate inside the subquery — the filter lives in the outer `WHERE`. Postgres generally cannot push a predicate through into a grouped subquery on the null-supplying side of a `LEFT JOIN`, so this plausibly materialises an aggregate over every playlist in the system to serve one user's six rows. Same shape at `:118` and `:485`. **Algorithmic argument, no measurement.** `EXPLAIN (ANALYZE, BUFFERS)` at production table size settles it in one query.
- **Indices are not the problem.** Worth stating because it changes what any fix would be: `idx_likes_user ON liked_tracks(user_id, liked_at DESC)` (`db.js:236`) covers `listLiked`'s filter and sort exactly; `idx_pl_tracks_order ON playlist_tracks(playlist_id, position)` (`:256`) covers the playlist fetch. The unbounded-endpoint cost is row count and payload size, not seek time. **Pagination, not indexing.**
- **Scale is not currently a problem, at one data point.** The signed-in account carries 117 liked tracks and a 289-track largest playlist. Comfortably served in one response. That is the product owner's own account and therefore likely the heaviest — but it is one account, not a distribution.

---

## Existing optimisation debt

The brief asks for caching over things that should be indexed, unbounded caches, premature parallelism, and work moved off-thread that the caller then blocks on. **I found none of the four**, and the near-misses are all deliberate and documented:

- The 15-minute track cache (`native/src/api/catalog.js:63-127`) is LRU-capped at 150 entries with a TTL — bounded, not unbounded.
- Fresco 24 MB / Coil 8 MB with trim handling — bounded, and the comments cite the measurements that set them.
- `Promise.allSettled` in `/api/catalog/search` fans out three calls where only one is required — not premature; the comment at `web/server/app.js:186-188` explains that suggest and user-playlists are supplementary and only a failed song search surfaces as an error.
- One genuine smell, already logged as S2: `cacheTracks` is a serial `await upsert(t)` loop fired unawaited after `res.json()`, so a 40-song search issues 40 sequential round-trips to Singapore *after* the response, and on Vercel post-response work may be frozen when the invocation completes. **Not measured**, so not attributed — but the shape is wrong regardless of the number.

---

## What measured fine

- Background playback memory (B): flat, plateaus, no leak.
- Audio underruns: zero across 10 and 7 minute runs on both devices.
- View recycling on a 289-row list (A): exact return to baseline.
- Cold start on B: 289 ms with a 4 ms spread.
- The `LONG_LIST` windowing fix: +37 MB for 289 rows against the +129 MB the pre-windowing implementation cost.
- Both test suites: `native` 46/271, `web` 70/499.

## What Phase 8 may draw from

Almost nothing, and that is the correct outcome rather than a failure. The brief's rule is that a technique with no Phase 7 measurement pointing at it is out of scope. Applying that honestly:

- **Eligible:** the ~78 MB retention (measured, repeatable, unattributed — but a heap dump would make it actionable).
- **Not eligible:** the jank number (artefact), the cold-start gap (inferred, unprofiled), every server row (unmeasured), re-render cost (unobserved).

Phase 8 should not be written until either a heap dump attributes the retention, or the missing Phase 6 rows are filled. Writing proposals now would be inventing work.
