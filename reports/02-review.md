# Phase 3 — senior review

Read-only. `native` @ `027ee93`, `web` @ `32d185d`. Repo name prefixes every path — there are two.

Defects and taste are separate lists and never mixed. No optimizations are proposed here; Phase 6 measures before Phase 8 proposes.

**Framing.** This codebase is in better shape than its size suggests. There is no TODO debt (Phase 4), both test suites pass, error handling is deliberate almost everywhere, and the hardest code in it — the playback recovery ladder, the queue restore, the drag gesture — is the *best* code in it, which is the right way round. The Critical list below is genuinely five items, not a padded five, and two of them are the same root cause seen from different ends.

---

## Critical

Will break, corrupt state, or lose user data.

### C1 — Caught failures reach no telemetry, so the app cannot report that it is broken

**What breaks.** Any failure that is caught and handled produces zero signal off-device. Playback gives up on a track, push registration fails, an API call 500s — the user sees a toast or an empty screen, and you learn nothing.

**How to trigger.** Put the device in airplane mode mid-track and let the recovery ladder exhaust. `native/src/playback/engine.js:806-807` fires `crumb('recovery', 'give-up', …)` and a toast. Check Sentry: nothing arrives.

**Why.** There is no `Sentry.captureException` anywhere in `native/src/` — the only Sentry event in the app is `Sentry.captureMessage('cold-open-timing', 'info')` at `native/src/lib/perfMarks.js:36`. `crumb()` (`native/src/lib/crumbs.js:7-18`) adds a **breadcrumb**, and breadcrumbs are payload attached to an event; with `tracesSampleRate: 0` (`native/index.js:30`) and no explicit captures, the only events are unhandled crashes, ANRs, and that one boot message on a 6-second timer (`perfMarks.js:33`). A failure outside that window ships nothing. Underneath, the 12 remaining `console.warn`/`error` sites are inert — JS console output does not reach logcat in release builds.

**Fix.** Add `Sentry.captureException` at the terminal failure points — the recovery give-up, `enqueuePlayOp`'s final failure (`native/src/playback/PlayerContext.jsx:163+`), push registration failure (`native/src/lib/push.js:59,62`), and a shared handler in `fetchAuthed`. One capture per genuine dead end, not per retry.

**Effort.** Small — under a day, but it needs judgment about which points are terminal so the dashboard doesn't fill with noise.

### C2 — Push has no priority and no notification channel

**What breaks.** Notifications do not arrive on a locked, dozing device, or arrive hours late, in a channel the app never named.

**How to trigger.** Lock the phone, leave it idle past the Doze threshold, send from the admin console. (Untested — this is the test that has never been run.)

**Why.** `web/server/push.js:65-71` builds the `android` block with `collapseKey`, `imageUrl`, and `color`, and sets **no `priority`**. FCM defaults an Android notification message to normal priority, and normal-priority messages to a dozing device are held until the next maintenance window. Separately, `native/android/app/src/main/AndroidManifest.xml` declares `default_notification_icon` (`:25-27`) and `default_notification_color` (`:31-36`) but **no `default_notification_channel_id`**, and `native/src/lib/push.js` creates no channel — so every push lands in the Firebase SDK's fallback channel at whatever importance the SDK chose.

**Fix.** Add `priority: 'high'` to the `android` block; create a named channel on the client and declare it as the manifest default, then set `channelId` on the send.

**Effort.** Small — hours. But it changes outward-facing behaviour on every user's phone, so it wants the on-device test alongside it, not after.

### C3 — Two thirds of database access bypasses the transient-retry wrapper

> **CLOSED** (2026-07-30, web `dev` `314cc2a`) — `reports/07-changelog.md:132`.
> `pool.query` itself now runs the same narrow transient-retry loop, and
> `query()` delegates into it, so the 133 direct call sites are covered without
> touching them. The finding below is left as written; it is the record of what
> was true, not a live item.

**What breaks.** A Neon socket reaped between acquisition and query returns a 500 to the user instead of retrying, on a failure mode `db.js`'s own comment calls routine.

**How to trigger.** Hard to force deliberately; it surfaces as intermittent unexplained 500s on the pooled endpoint, disproportionately after idle periods.

**Why.** `web/server/db.js:68-77` exists specifically for this: `query()` retries only transient connection errors (`isTransient`, `:56-64`), twice, with 100/200 ms backoff, and never retries SQL or constraint errors. But there are **133 direct `pool.query(` calls** against **66** uses of the wrapper. Heaviest: `web/server/auth.js` (33), `web/server/playlists.js` (18), `web/server/lyricsJobs.js` (15), `web/server/otp.js` (9), `web/server/autoPlaylists.js` (8), `web/server/discoveryMix.js` (8). Some are correct by design — the comment at `:65-67` says multi-statement transactions must retry at the transaction boundary instead — but that cannot account for 133.

**Fix.** Audit the 133 and convert every single-statement read and idempotent write to `query()`. Leave transaction bodies alone and say so in a comment where you do.

**Effort.** Medium — mechanical but wide, and it touches auth, so it wants care and a test pass rather than a sweep.

### C4 — No timeout on any upstream fetch, on either side of the seam

**What breaks.** One hung JioSaavn or Gemini connection becomes a 60-second occupied serverless invocation and a 60-second spinner in the app, with no error and no recovery.

**How to trigger.** Block the upstream host at the network layer, or point it at a socket that accepts and never responds.

**Why.** `web/server/catalog.js`, `web/server/artists.js`, `web/server/llm.js`, and `web/server/lyricsJobs.js` contain **zero** `AbortController` / `AbortSignal` / `signal:` references — e.g. the bare `fetch(url, { headers: … })` at `web/server/catalog.js:104`. Node's `fetch` has no default timeout. The function is capped only by `maxDuration: 60` (`web/vercel.json:10`). On the client, `fetchAuthed` (`native/src/lib/auth.js:492-502`) sets no default `signal` — it forwards whatever the caller passes, and most callers pass nothing.

**Fix.** An `AbortSignal.timeout(n)` default in the server's upstream fetch helpers and a default deadline in `fetchAuthed`, with per-call override.

**Effort.** Small on the server, small-but-careful on the client — a default timeout on `fetchAuthed` changes behaviour for all 24 API modules at once.

### C5 — Unbounded list endpoints with no pagination and no client-side ceiling

**What breaks.** A single account large enough turns one request into a multi-megabyte response and a list the client must hold entirely in memory. Nobody has met that account yet, which is the only reason this is latent rather than live.

**How to trigger.** Unknown — requires production scale data, which is Phase 6's job.

**Why.** Seven endpoints return whole row sets with no `LIMIT` and no cursor:

| Endpoint | Query |
|---|---|
| `GET /api/likes` | `web/server/likes.js:18-32` |
| `GET /api/likes?ids=1` | `web/server/likes.js:35-41` |
| `GET /api/playlists/:id` | `web/server/playlists.js:162-170` |
| `GET /api/playlists` | `web/server/playlists.js:75-93` |
| `GET /api/playlists/saved` | `web/server/playlists.js:475-491` |
| `GET /api/hidden` | `web/server/hiddenTracks.js:34-47` |
| `GET /api/journal?days=N` | `web/server/journal.js:41-51` |

Only `/api/history` is paginated (`web/server/app.js:945`, 80 default / 200 max) — and it is the *smallest* risk of the set, because history is the one thing that naturally grows without bound.

**Worth stating clearly: this is not an indexing problem.** The indices match the queries exactly — `idx_likes_user ON liked_tracks(user_id, liked_at DESC)` (`web/server/db.js:236`) covers `listLiked`'s filter and sort; `idx_pl_tracks_order ON playlist_tracks(playlist_id, position)` (`:256`) covers the playlist fetch; `idx_playlists_user` (`:247`) covers the list. The cost is row count and payload size, not seek time. The fix is pagination, not an index.

**Fix.** Cursor pagination on the four that can grow without a natural ceiling (`likes`, `playlists/:id`, `hidden`, `journal`), with the client's existing `LONG_LIST` windowing feeding page requests.

**Effort.** Large — it is an API contract change across the seam, and both clients (native and web) consume these.

---

## Should fix

Real defects, not urgent.

**S1 — `/api/catalog/search` has no error guard.** `web/server/app.js:174-244`, 71 lines, no `try`, no `asyncHandler` — the only route in `app.js` in that state. Its awaits use `Promise.allSettled` so no rejection escapes there, and the sync ranking code is heavily optional-chained; I could not identify a reachable throw. But if one ever exists, Express 4 won't forward it, `processGuards` will log it, and **the client gets no response for 60 seconds**. Wrap it. Effort: minutes.

**S2 — `cacheTracks` is a serial write loop fired after the response.** Called unawaited at `web/server/app.js:243`, `:317`, `:1036`, `web/server/artists.js:262`, `:338`, `web/server/related.js:233`. It cannot reject (per-row catch at `web/server/tracks.js:46-52`) — that axis is clean. But it is `for (const t of tracks) await upsert(t)`, so a 40-song search issues 40 serial round-trips to Singapore *after* `res.json()`, and on Vercel post-response work can be frozen when the invocation completes. The cache is therefore silently partial. Effort: small — batch into one multi-row upsert.

**S3 — `storedPositionSec`'s guard window is duplicated.** `0.01 < progress < 0.98` plus the matching-`trackId` and `durationSec > 0` checks exist twice: `native/src/playback/PlayerContext.jsx:103-117` and `native/src/hooks/usePlaybackProgress.js:16-23`. They must agree or the seeded display disagrees with where the audio actually seeks. Both files know this — `usePlaybackProgress.js:9-10` says "same window/track guards as `storedPositionSec`". A shared helper would make it structural rather than remembered. Effort: small. **Touches playback semantics — Phase 5 escalation rule applies.**

**S4 — 31 of 34 MMKV keys are unversioned.** Only `aura.queue` (in-payload, `PlayerContext.jsx:52`), `aura.trackCache.v1`, and `aura.autoNext.v1` carry a version. Every other key would be read as-is by a future shape change. `aura.queue`'s approach is the right pattern and the reasoning at `:47-51` explains exactly why the version goes in the payload and not the key. Effort: small per key; the question is which ones actually warrant it.

**S5 — Listener and timer lifecycle is unaudited.** 24 `addEventListener` call sites against 13 removals; 9 `setInterval` against 12 `clearInterval` in `native/src/`. These are **heuristic counts, not confirmed leaks** — several subscriptions are process-lifetime by design and do clean up (e.g. the boot `AppState` sub removes itself at `PlayerContext.jsx:1100`). Somebody should walk all 24 once and mark each as intentional or fix it. Effort: small, tedious.

**S6 — `web`'s lint doesn't cover `server/`.** `"lint": "eslint src"` (`web/package.json`). 10,174 lines of server code across 43 modules are unlinted. Effort: minutes to change, unknown to fix whatever it surfaces.

**S7 — `npm run android:release` cannot be run from PowerShell.** The script chains `call scripts\env.cmd && cd android && call gradlew assembleRelease`; `call` is a cmd.exe builtin. Anyone (or anything) driving the build from PowerShell hits `'m' is not recognized` and has to invoke `gradlew.bat` by hand with the env set. Effort: small — a `.cmd` wrapper or a cross-shell script.

---

## Performance suspicions

Where I would point a profiler, and why. **No optimization is proposed and none should be attempted before Phase 6 measures.** Each carries the method to confirm.

**P1 — `listPlaylists` aggregates two entire tables per request.** `web/server/playlists.js:75-93` joins against two unfiltered grouped subqueries:

```sql
LEFT JOIN (SELECT playlist_id, COUNT(*) AS cnt  FROM playlist_tracks       GROUP BY playlist_id) c
LEFT JOIN (SELECT playlist_id, COUNT(*) AS ccnt FROM playlist_collaborators GROUP BY playlist_id) cc
```

Neither is restricted to this user's playlists; the `user_id` predicate lives in the outer `WHERE`. Postgres generally cannot push a predicate through into a grouped subquery on the null-supplying side of a `LEFT JOIN`, so this plausibly materializes an aggregate over *every playlist in the system* to serve one user's ~10 rows — cost O(all rows in `playlist_tracks`) per call. The same shape repeats at `web/server/playlists.js:118` (`searchPlaylists`) and `:485` (`listSavedPlaylists`). **This is an algorithmic argument, not a measurement.** Confirm with `EXPLAIN (ANALYZE, BUFFERS)` on the deployed database at real table size.

**P2 — `renderItem` and `keyExtractor` are new closures every render.** `native/src/screens/PlaylistScreen.jsx:451` defines `renderRow` inline in the component body, and `:485` passes `keyExtractor={item => item.id}` inline. Both change identity on every parent render. `DetailRow` itself is **not** memoized — `React.memo` appears at only 3 call sites in all of `native/src/`, in `LyricsOverlay.jsx` and `QueueSheet.jsx` only. So any state change in `PlaylistScreen` plausibly re-renders every mounted row. Confirm with React DevTools Profiler or `Profiler` render counts on a 289-row list while typing in the filter box.

**P2b — the image cache is where the memory goes, and nothing evicts it.** *Measured this pass, RMX3371, release build — see `reports/01-stability.md` §5 for the full run.* Opening a 289-track playlist and scrolling it end to end took PSS from 284 MB to a 384 MB peak. Leaving the screen returned the **view count** to its exact pre-open value (539 → 1134 → 539) but left PSS at **362 MB**. So roughly 78 MB is held by something with a lifetime independent of the views — the decoded-bitmap cache is the obvious candidate, since scrolling 289 rows touches 289 distinct artwork URIs.

Two things make this worth a profiler rather than a guess. First, `TrackArt` (`native/src/components/TrackRow.jsx:17-49`) is *well* built for this — `res = 150` default, `resizeMethod="resize"`, and a comment at `:36-40` that names the OOM-kill history explicitly. Second, `DetailRow` calls it as `<TrackArt track={track} size={54} radius={4} />` (`native/src/components/detail/DetailChassis.jsx:106`) **without passing `res`**, so it takes the 150 default for a 54 px view — a 2.8× linear oversample, ~8× by area.

And `artUrl` (`native/src/utils/artUrl.js:3-6`) is `url.replace(/\d+x\d+/, '150x150')` — it only resizes URLs that *contain* an `NxN` token. A user-uploaded playlist cover on Vercel Blob has no such token, so the replace is a silent no-op and the full-resolution upload is fetched. That is precisely the case `TrackArt`'s own comment warns about; `resizeMethod="resize"` bounds the decode but not what the cache retains. Confirm with a heap dump (`am dumpheap`) after the scroll, and with `dumpsys meminfo` split by category before/after.

**P3 — The `LONG_LIST` window constants have no measurement behind them at this HEAD.** `initialNumToRender: 14`, `maxToRenderPerBatch: 12`, `updateCellsBatchingPeriod: 40`, `windowSize: 3` (`native/src/lib/listWindow.js:9-14`). The comment justifies them against the *old ScrollView* implementation. Whether 3 viewports is the right steady state for text-only rows on a 60 Hz panel is unmeasured. Confirm with `dumpsys gfxinfo framestats` during a 245-row scroll, varying `windowSize`.

**P4 — Cold-open stage attribution is instrumented but unread.** `native/src/lib/perfMarks.js` already stamps `js-entry`, `setup-player`, `restore-fetch`, `restore-synced` and ships them as a Sentry context on every cold start at `SAMPLE = 1.0`. **The instrumentation exists; the numbers have never been read.** This is the cheapest measurement available in the whole project — it needs a dashboard visit, not code. Confirm: open Sentry, read the `boot-timing` context on recent `cold-open-timing` events.

**P5 — Restore is network-gated beyond a 15-minute cache TTL.** `native/src/api/catalog.js:64` sets `TRACK_TTL_MS = 15 min`, cap 150 entries. The boot path refetches current+next through it (`native/src/playback/PlayerContext.jsx:1058-1081`). Past the TTL — i.e. the once-a-day open, the common case — audio waits on Mumbai → Singapore. Whether 15 minutes is the right TTL is a product/CDN-expiry question, not a tuning one; the measurement that matters is how long that round-trip actually takes from a real Indian mobile network. Confirm: read `restore-fetch` minus `setup-player` from the same Sentry boot table as P4.

**Measured fine, no suspicion:** cold start to first activity frame is 907/502/453 ms, median **502 ms** (RMX3371, release build, `am start -W`, 3 runs) — well inside any reasonable budget, though this measures the activity frame, not a usable UI. Idle PSS after launch is **136 MB** (RMX3371, launched behind lock screen — treat as a floor).

---

## Architecture

Where structure fights the feature work.

**A1 — The client holds no durable state, and the seam pays for it every time.** This is the decision the brief flags, and its cost is concrete and recurring:

- Every list screen is a network round-trip or a JSON blob in MMKV. There is no queryable local store, so "show me my liked songs sorted by artist" is either a full fetch or an in-memory sort of a whole deserialized array.
- Pagination is genuinely hard to add (C5) precisely because there is nowhere to *put* page 1 while fetching page 2 except more React state.
- The `aura.snapshot.<name>` family (`native/src/lib/snapshot.js:11`) and `homeCache` are hand-rolled per-screen caches — each one is a small reimplementation of what a local database would give once.
- The 15-minute track cache (`native/src/api/catalog.js:63-127`) is a hand-rolled LRU with manual persistence, in-memory mirror, and TTL. It is well written. It is also ~65 lines of cache infrastructure that exists because there is no store.

I am **not** proposing a local database — that is a large architectural change and the brief did not ask for one. I am naming the cost so the pagination decision in C5 is made with it in view: adding cursors to four endpoints without somewhere to accumulate pages will push complexity into React state, and that is the expensive half.

**A2 — The queue is client-authoritative with no server counterpart.** There is no queue table; `/api/playback/{now,heartbeat,resume}` records what is playing for presence, not a queue. Two devices on one account diverge permanently and silently. This is a defensible product decision — but it means Phase 5's oracle line *"queue state matches the server"* is not a checkable condition. **Flagging now rather than at the gate.** I need to know what you want that line to mean.

**A3 — `android/kotlin-audio` is a source fork with no upstream tracking.** 11 marked `AURA` divergences across 6 files, and four of them are load-bearing enough that losing one silently would look like a new bug: the `WakeMode.NETWORK` default (`models/PlayerConfig.kt:35`), the bytes/kilobytes fix (`players/components/PlayerCache.kt:18`), the `audioSessionId` accessor (`players/BaseAudioPlayer.kt:96`), and the notification custom action (5 sites in `notification/NotificationManager.kt`). The in-source `AURA` markers are the right discipline and they are applied consistently. What is missing is the upstream base commit recorded anywhere, so nobody can diff the fork against what it forked from.

**A4 — The `pool.query` / `query()` split is invisible at the call site.** C3 is a symptom; the cause is that both are exported from `web/server/db.js` and look identical. Nothing at a call site says which one you should have used.

---

## Taste

Short, optional, and separate on purpose. None of these are defects.

- `native/src/screens/YouScreen.jsx` is 1,568 lines and `native/src/overlays/LyricsOverlay.jsx` is 1,765. Nothing is wrong with either; they are just past the size where a newcomer can hold them in their head.
- `native/src/api/` has 24 files each wrapping one or two endpoints in near-identical `if (!res.ok) throw new Error(...)` boilerplate. A shared `json()` helper would remove most of it. It would also be a refactor touching the whole seam, which is exactly the kind of change that should not be bundled with anything.
- The comment density is high and unusually good — several findings in this audit came from comments, not code.
- `web/server/app.js` at 1,498 lines holds 74 inline route handlers while `auth.js`, `family.js`, and `modes.js` use routers. The router pattern is better and is already in the codebase; `app.js` just predates it.

---

## Open questions

Odd code I will not guess the intent of.

1. **`native/src/api/catalog.js:106-113` — `clearTrackCache` is exported and called by nothing** in normal flow. Its own comment says it exists "for tests and for a future storage-panic escape hatch". Is the storage-panic path planned, or should this be test-only?
2. **`web/server/db.js:12-23` — `ensureDatabase()` connects as admin and issues `CREATE DATABASE`.** Convenient for local dev; I could not find it called on the serverless path, but I did not trace every entry. Is it reachable in production, and should it be?
3. **Two different `artUrl` helpers exist.** `native/src/playback/engine.js:34` defines a local one that rewrites to `500x500` for the notification; `native/src/utils/artUrl.js:3` exports a different one defaulting to `150x150` for list rows. Same name, same regex approach, different defaults, neither imports the other. Deliberate, or did one get copied?
4. **A2 above** — what should "queue state matches the server" mean in the Phase 5 oracle, given there is no server-side queue?
