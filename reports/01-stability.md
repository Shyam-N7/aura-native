# Phase 2 — stability

Measured against the five milestone criteria, in their stated priority order. Nothing else counts as the bar here.

Repos and HEADs as in `docs/CONTEXT.md` (`native` @ `027ee93`, `web` @ `32d185d`), both verified clean.

**Device note, applies to every number in this report:** the only device is the realme RMX3371 — SM8250, 5.4 GiB RAM, Android 14, ColorOS V14. That is 2020–21 flagship silicon. **No number here generalizes to a mid or entry-tier device.**

**What blocked device work this pass:** the phone is locked and its lock screen is displaying personal notification content, so I stopped UI dumping. Media volume reads 7/16 (≈44%), and this ROM offers no way to lower it from adb — `cmd media_session volume` accepts only `dispatch`/`list-sessions`/`monitor`/`volume`, and `--set` reports success while leaving the value unchanged; there is no `--adjust`. So no audio-dependent test was run. Silent measurements (launch timing, PSS) were taken and are labelled.

---

## Verdict summary

| # | Criterion | Verdict |
|---|---|---|
| 1 | No silent failures — every failure path reaches telemetry | **Not met** (client). Met on the server. |
| 2 | Backgrounded push demonstrably arrives on a locked screen | **Not met as specified** — two concrete config gaps; end-to-end still unproven |
| 3 | Playback survives screen-off + one ColorOS kill, full album | **Unverifiable this pass** — static evidence is strong |
| 4 | Cold open restores position without waiting on the network | **Met for the display; partially met for audio** |
| 5 | A 245-row list opens within budget on a 3 GB device | **Unverifiable this pass** — and the premise needs correcting |

**Plain-language call:** this is not a fragile codebase. The playback core is unusually well-built for its size — the error-recovery ladder, the op-chain serialization, and the queue-restore path are all carefully thought through and carry their reasoning in-source. Two of the five criteria fail, and both fail the same way: **a shipped subsystem that works has no way to tell you when it doesn't.** Criterion 1 is the root; criterion 2 is downstream of it, because the push gaps below would have been visible for months if anything reported them. Criteria 3 and 5 are almost certainly fine and cannot be claimed without the device.

---

## 1. Silent failures — **not met** (client), **met** (server)

### Client

**There is not a single `Sentry.captureException` call in the entire app.** The only Sentry event emitted anywhere in `native/src/` is one info message:

- `native/src/lib/perfMarks.js:36` — `Sentry.captureMessage('cold-open-timing', 'info')`, fired once per cold start on a 6-second timer (`:33`), `SAMPLE = 1.0` (`:18`).

Everything else that could report a failure is a breadcrumb. `crumb()` (`native/src/lib/crumbs.js:7-18`) calls `Sentry.addBreadcrumb` at `level: 'info'`. **Breadcrumbs are not telemetry on their own** — they are payload attached to an event, and they leave the device only when an event is sent. With `tracesSampleRate: 0` (`native/index.js:30`) and no explicit captures, the only events are: an unhandled JS error, a native crash, an ANR (`enableAppHangTracking: true`, `:28`), session pings (aggregate, no breadcrumbs), and that one boot message.

**Net effect:** a failure that is caught and handled — which is nearly all of them, because this codebase handles its errors — produces **no telemetry at all** unless it happens inside the ~6-second boot window that `cold-open-timing` happens to ship.

The most concrete case. `native/src/playback/engine.js:806-807`:

```js
crumb('recovery', 'give-up', { id: cur.id, attempts: recovery.attempt });
showToast("couldn't play this track — skipping.");
```

A track that exhausted the entire recovery ladder — the clearest possible "playback is broken for this user" signal — produces a toast and a breadcrumb that will never be transmitted.

Breadcrumb coverage is 8 call sites total: `equalizer.js:221,251`, `perfMarks.js:25`, `engine.js:730,806`, `service.js:107,113,122`. **Not** covered: push registration failure, any `src/api` HTTP failure, auth failure, MMKV write failure, or engine op failure.

Below that, the console layer is dead weight in production. 12 `console.warn`/`error`/`log` sites remain (`PlayerContext.jsx` ×5, `push.js` ×3, `QueueSheet.jsx`, `auth.js`, `audioQuality.js`, `api/events.js` ×1 each), and **JS console output does not reach logcat in release builds** — verified previously by a full cold launch producing zero `ReactNativeJS` lines. `babel.config.js` has no `transform-remove-console`, so the calls execute; their output goes nowhere.

And 56 of the 231 `catch` occurrences in `native/src/` open with `catch {` and are empty or comment-only.

**One thing that is right:** the local black box. `installCrashLogger()` (`native/src/lib/crashLog.js:31-56`) persists a fatal JS error to MMKV synchronously before letting the crash proceed, and the settings shelf can read it next launch. It runs at `native/index.js:19`, **before** `Sentry.init()` at `:26` — which is the correct order: Sentry's handler installs later and therefore wraps ours, so Sentry records first and then delegates down the chain to the MMKV write and finally RN's default. This resolves a previously-open question; the ordering is not a bug. *(Whether Sentry's native layer reliably flushes the envelope before process death is `(inferred)` from how the SDK is documented to work; unverified without a real field crash.)*

### Server — met

Genuinely solid, and worth saying so:

- `errorMiddleware` (`web/server/middleware/errors.js:44-51`) is the single terminus, mounted last (`web/server/app.js:1496`). It logs `method`, `url`, and full stack server-side, and sends only a sanitized message.
- `clientError` (`:25-32`) never leaks upstream provider bodies, Gemini text, or Postgres internals — `expose: false` hides always, 5xx collapses to generic.
- `installProcessGuards()` (`web/server/processGuards.js:13-25`) is registered at **every** entry point (`web/api/index.js:11`, `web/api/loudness-measure.js:15`, `web/server/index.js:9`). It exists precisely because Express 4 does not forward async-handler rejections and Node 20 defaults to `--unhandled-rejections=throw` — without it one stray rejection kills the warm instance and every in-flight request on it.

**What an unhandled rejection actually does in a Vercel function here:** `processGuards` catches it, `console.error`s it (which does reach Vercel's log drain — real telemetry), and the instance survives. But **no response is ever sent for that request**, so the client hangs until the function's `maxDuration: 60` (`web/vercel.json:10`). See finding below on `/api/catalog/search`.

---

## 2. Push on a locked screen — **not met as specified**

The send shape is right; two delivery-critical fields are missing.

**What is correct.** `web/server/push.js:62-73` sends via `sendEachForMulticast` with a top-level `notification: { title, body }`. That makes it a *notification message*, which the FCM SDK renders on the OS's behalf — so it displays even when the app process is dead. That is the right choice and it is what makes locked-screen delivery possible at all. Dead tokens are pruned on the spot (`:75-82`) using a deliberately narrow code set (`:39-42`) so a payload mistake can't mass-delete healthy registrations. The guardrail layer (`sendCategory`, `:116-142`) — quiet hours, per-category gaps, a combined daily cap — is well designed.

**Gap 1 — no priority.** The `android` block (`web/server/push.js:65-71`) sets `collapseKey`, `imageUrl`, and `color`. It does **not** set `priority: 'high'`. FCM defaults an Android notification message to normal priority, and a normal-priority message to a device in Doze is **held until the next maintenance window** rather than delivered on arrival. A locked, idle, screen-off ColorOS phone is exactly that device. This alone can account for "push doesn't appear" without anything being broken in registration or send.

**Gap 2 — no notification channel.** `native/android/app/src/main/AndroidManifest.xml` declares `default_notification_icon` (`:25-27`) and `default_notification_color` (`:31-36`) but **no `default_notification_channel_id`**. `native/src/lib/push.js` creates no channel — there is no `channel` reference anywhere in the file. The server sets no `channelId` either. So on API 26+ every AURA push lands in the Firebase SDK's fallback channel, which the user sees as a generically-named entry in notification settings and which carries the SDK's default importance, not one this app chose.

**What is confirmed working** (from prior investigation, unchanged at this HEAD): registration reaches the server for real devices; FCM delivers to a foregrounded app in ~1.3 s; `POST_NOTIFICATIONS` is granted on the real user profile. The permission ask itself was fixed and is correct now — `askOsPermission()` (`native/src/lib/push.js:76-87`) goes through `PermissionsAndroid.request(POST_NOTIFICATIONS)` on API 33+ rather than Firebase's `requestPermission`, which returns a hard-coded `AUTHORIZED` on Android without showing anything (`:66-75` documents this well).

**Still unproven:** an actual push arriving on this locked phone with the app backgrounded or killed. That is the one test that decides this criterion and it has never been run. It needs the phone unlocked and a send from the admin console.

---

## 3. Screen-off through a ColorOS kill — **unverifiable this pass**

No audio test could be run (volume, above). What the code says:

**In favour — the configuration is right:**
- `WakeMode.NETWORK` is the vendored default (`native/android/kotlin-audio/.../models/PlayerConfig.kt:35`). RNTP's `MusicService` builds `PlayerConfig` without specifying one, so the fork's default is the only lever, and it holds ExoPlayer's partial wake lock plus a wifi lock while `playWhenReady`. This is the fix for CPU/radio sleeping mid-buffer.
- `appKilledPlaybackBehavior: ContinuePlayback` by default (`native/src/playback/engine.js:76-80`), user-overridable via `aura.backgroundPlay`.
- The foreground service is RNTP's `MusicService`, merged in from RNTP's manifest along with `WAKE_LOCK` and `FOREGROUND_SERVICE*` (`native/android/app/src/main/AndroidManifest.xml:5-7`).

**What survives a kill:** the queue is persisted on a 400 ms debounce plus an unmount flush (`native/src/playback/PlayerContext.jsx:1211-1240`) — and the unmount flush exists specifically because a queue edited in the final 400 ms of a session used to come back stale (`:1236-1239`). Position is written on a 5-second **throttle**, not a debounce (`:277-280`: the timer is armed on the first tick and not reset by later ones). So a SIGKILL costs at most ~5 seconds of position and at most 400 ms of queue edits. A ColorOS kill fires no lifecycle callback, so neither flush runs — the throttle interval *is* the worst case.

**What restores after:** boot adopts the live service state via `engine.getPlayWhenReady()` (`:1041-1048`) — added because a reattached process used to show "play" while audio ran on. `enqueuePlayOp` (`:163-...`) retries once after rebuilding the native queue from the model, because the post-kill state is exactly "model full, native empty".

**The honest gap:** an album is ~45–60 minutes. Nothing here has been observed across that span with the screen off and a kill in the middle. The configuration predicts success; only a soak proves it.

---

## 4. Cold open without network — **met for display, partially met for audio**

Two separate questions hide in this criterion and they have different answers.

**Does the position *display* correctly without a round-trip? Yes.** `loadStoredQueue()` runs as the `useState` initializer (`native/src/playback/PlayerContext.jsx:122-124`) — a synchronous MMKV read, so track metadata is on the first frame. The scrubber is seeded from MMKV too: `usePlaybackProgress` (`native/src/hooks/usePlaybackProgress.js:11-33`) reads `aura.position` and `aura.queue` directly and returns that seed until the engine reports real data once (`:44-49`). It is carefully done — `engineSeen` latches on the first `duration > 0` so the seed can never shadow a genuine 0:00 on a fresh pick (`:40-46`). This is exactly the fix the criterion asks for and it is already built.

**Does *audio* resume without a round-trip? Sometimes.** Persisted tracks deliberately drop `streamUrl` (`native/src/playback/PlayerContext.jsx:1222-1225`) because CDN links are short-lived, so the boot path refetches the current and next track before syncing the engine (`:1058-1081`). That refetch goes through `getTrack`, which has a **15-minute, 150-entry, MMKV-backed LRU cache** (`native/src/api/catalog.js:63-65, 120-127`). Inside the TTL it returns instantly with no network. Beyond it — reopening the app the next morning, the common case — the restore blocks on a round-trip to Mumbai and onward to Singapore before any audio.

So: **the criterion as literally worded is met** (position is restored, no network needed). The thing it was presumably protecting against — silence for seconds after a cold open — is met only within 15 minutes.

The restore also correctly refuses to fight the user: `userActedRef` is checked at three points (`:1054`, `:1066`, `:1084`) so a play tap during the restore window wins, and that tap carries `storedPositionSec(q)` forward rather than discarding it (`:654-658`).

---

## 5. 245-row list on 3 GB — **measured on flagship; 3 GB still unverifiable**

*Measured after the device was unlocked. All numbers: RMX3371, release build `versionName=0.1.0` / `versionCode=100`, media volume 0. That the installed APK is built from `027ee93` is `(inferred)` from install timing, not verified.*

**Correction to something I wrote in the first draft of this report.** I claimed no long list renders artwork, on the strength of `DetailChassis.jsx` containing zero occurrences of the string `Image`. **That was wrong** — the rows do render artwork, via `TrackArt` (`native/src/components/TrackRow.jsx:17-49`), imported at `native/src/components/detail/DetailChassis.jsx:6` and rendered at `:106`. My grep matched a literal that the component name doesn't contain. A screenshot of the running app settled it.

**The test.** This account has a **289-track** playlist — larger than the 245 the original finding used. Real scale for this account: **117 liked songs, 6 playlists**, 1,252 tracks played.

| Stage | PSS | Views |
|---|---|---|
| Library screen, before opening | 284 MB | 539 |
| +1 s after tapping the 289-track playlist | 308 MB | 558 |
| +4 s (peak) | **321 MB** | 778 |
| +10 s, settled | 313 MB | 776 |
| After 20 fast scrolls | 382 MB | 1134 |
| After 40 fast scrolls | **384 MB** | 1001 |
| Back out to home, +5 s | **362 MB** | **539** |

**What this says, in order of importance:**

1. **The windowing fix works.** Opening 289 rows costs **+37 MB**, not the +129 MB (232 → 361) of the old `ScrollView` implementation the `listWindow.js:3-6` comment describes. `native/src/screens/PlaylistScreen.jsx:448-450` confirms that measurement was against "the old ScrollView map" — code that no longer exists. The `LONG_LIST` bounds did their job.

2. **View recycling is correct.** 539 → 1134 during scroll → **exactly 539** after leaving. Views are not the leak.

3. **Memory is, though.** PSS went 284 → 384 peak → **362 after the views were gone**. Roughly **78 MB is retained with a lifetime independent of the view tree** — consistent with a decoded-bitmap cache that scrolling 289 distinct artwork URIs filled and nothing evicts. Attribution and confirmation belong in Phase 7; the candidate mechanism is written up as P2b in `reports/02-review.md`.

4. **The app was already swapping before any of this.** `TOTAL SWAP PSS` read 72–76 MB at rest on the library screen and fell to 30 MB as the list pushed resident pages up. On a 5.4 GiB device.

**So: is the criterion met?** On this device, opening a 289-row list is comfortably survivable — it is the *residue* that is concerning, not the spike. **On a 3 GB device I still will not estimate.** `lowmemorykiller` thresholds, `dalvik.vm.heapgrowthlimit`, and ColorOS's own policy differ per device and are not derivable from this one. What I can say is that a steady state of **362 MB after browsing a single playlist** is a materially worse starting position for a small device than the 284 MB the app sat at beforehand, and that the direction of travel is monotonic within a session. The brief's own instruction stands: get an entry-tier device or a throttled emulator profile before this criterion is claimed either way.

**Also measured, same device, same build:**

| Metric | Value | Caveat |
|---|---|---|
| Cold start, `am start -W` TotalTime | 907 / 502 / 453 ms → median **502 ms** (3 runs) | Activity's first frame, *not* a usable UI. Run 1 is a cold-page-cache outlier. A 4th run after unlock read 515 ms. |
| PSS, launched behind lock screen | 136 MB | Not foreground-rendered. A floor, not a baseline. |
| PSS, home + library rendered | 279–284 MB | The real idle baseline. |

---

## Beyond the five

### Confirmed defects

**A. `/api/catalog/search` has no error guard at all.** `web/server/app.js:174-244` — 71 lines, no `try`, no `asyncHandler`. Its awaits are wrapped in `Promise.allSettled` (`:189-193`), so no rejection escapes there; but the ~50 lines of ranking and mapping after it are unguarded. A synchronous throw becomes a rejected promise from an async handler, which Express 4 does not forward, which `processGuards` logs — and **the client never receives a response**, hanging until the 60 s function timeout. Reviewing the sync code, it is heavily optional-chained (`sug.albums ?? []`, `a?.name ?? ''`) and I could not identify a reachable throw, so this is **structural exposure, not a live bug**. It is the only one of the 74 `app.js` routes in that state; every other async route I checked uses inline `try`/`catch`, and the auth router uses `asyncHandler` consistently (13 sites).

**B. Two thirds of database access bypasses the transient-retry wrapper.** `web/server/db.js:68-77` defines `query()` specifically to survive Neon reaping a socket mid-query — the failure mode its own comment calls routine on the pooled endpoint. There are **133 direct `pool.query(` calls** against **66** uses of the wrapper. The heaviest bypassers: `auth.js` (33), `playlists.js` (18), `lyricsJobs.js` (15), `autoPlaylists.js` (8), `discoveryMix.js` (8), `otp.js` (9). A dropped socket on any of those becomes a 500 rather than a retried success. Some of these are deliberate — multi-statement transactions must retry at the transaction boundary, which the comment at `:65-67` says explicitly — but 133 is far past that explanation.

**C. No timeout on any upstream fetch.** `web/server/catalog.js`, `artists.js`, `llm.js`, `lyricsJobs.js` contain **zero** `AbortController`/`AbortSignal`/`signal:` references. A hung JioSaavn or Gemini connection occupies the serverless invocation until `maxDuration: 60`. The client has no timeout either: `fetchAuthed` (`native/src/lib/auth.js:492-502`) passes through whatever the caller gives it and sets no default. So a hung upstream is a 60-second spinner in the app.

**D. Fire-and-forget writes after `res.json()`.** `cacheTracks(songs)` is called unawaited at `web/server/app.js:243`, `:317`, `:1036`, `web/server/artists.js:262`, `:338`, `web/server/related.js:233`. It cannot reject — it catches per-row internally (`web/server/tracks.js:46-52`) — so this is **not** an unhandled-rejection risk, and I am recording it as checked-and-clean on that axis. The real issue is different: it is a sequential `await upsert(t)` loop, so a 40-song search fires 40 serial round-trips to Singapore *after* the response is sent, and on Vercel work scheduled after the response may be frozen when the invocation completes. The cache write is therefore silently partial by design-accident.

### State drift, MMKV ↔ server

Enumerated in `docs/CONTEXT.md` §6. The material ones for stability: **the queue has no server-side counterpart at all**, so two devices on one account diverge permanently and silently — that is a product decision, not a bug, but it means "queue state matches the server" (Phase 5's oracle) is not a checkable condition, because there is nothing to match against. The 15-minute track cache means server-side metadata edits are invisible for that window.

Only three MMKV keys carry a version: `aura.queue` (in-payload, `PlayerContext.jsx:52`), `aura.trackCache.v1`, `aura.autoNext.v1` (in-key). The other ~31 would be read as-is by any future shape change. `aura.queue`'s handling is the model to copy — versioned inside the payload precisely so a renamed key can't silently discard a user's queue (`:47-51`).

### Leaks and lifecycle

24 `addEventListener` call sites against 13 removal/unsubscribe sites in `native/src/`; 9 `setInterval` against 12 `clearInterval`. Both ratios are **heuristic counts, not confirmed leaks** — several listeners are process-lifetime by design (`index.js` registration, the boot `AppState` subscription which does remove itself at `PlayerContext.jsx:1100`). I did not audit all 24 individually. Flagged for Phase 3, not asserted here.

`TrackPlayer.reset()` appears once (`native/src/playback/engine.js:210`). There is no explicit player teardown, which is correct for a service that is meant to outlive the JS process.

### Not checked

- Permission revocation mid-run (notifications or audio) — no code path found that re-checks after the initial grant, but I did not trace it exhaustively.
- Behaviour when a real account exceeds 245 rows — requires production data.
- Whether production `DATABASE_URL` uses Neon's `-pooler` endpoint.
- Any of `web/src/` (the web client) beyond directory level.
- Test coverage percentage — no coverage run performed.

---

## Risk table

Ranked likelihood × blast radius. "Likelihood" is per-user-per-month unless stated.

| # | Risk | Likelihood | Blast radius | Net |
|---|---|---|---|---|
| 1 | A user-visible failure occurs and you never learn of it | **Certain** — it is the default behaviour of every caught error | Every subsequent diagnosis starts blind; drives everything below | **Highest** |
| 2 | Push silently not delivered on a dozing locked device | **High** — normal priority + Doze is the documented deferral path | A whole shipped subsystem appears dead; re-engagement product does nothing | **High** |
| 3 | Cold open after >15 min is silent until a Singapore round-trip returns | **Certain** for the once-a-day open | Seconds of dead air on the most common launch | Medium-high |
| 4 | Neon drops a socket on one of the 133 unwrapped `pool.query` calls | Low per request, **high in aggregate** | One 500; user sees a failed screen with no retry | Medium |
| 5 | Upstream (JioSaavn/Gemini) hangs | Low | 60 s spinner, one occupied serverless instance | Medium |
| 6 | Large account exceeds the tested 245 rows on an unbounded endpoint | **Unknown — no production data** | Slow-to-unusable list screen; possible OOM on a small device | Unknown, potentially high |
| 7 | `/api/catalog/search` throws in its unguarded ranking block | **Very low** — no reachable throw identified | Request hangs 60 s, no response | Low |
| 8 | ~5 s of playback position lost to a hard kill | Certain on every ColorOS kill | Resumes ≤5 s early — barely perceptible | Low |
| 9 | A future MMKV shape change misreads an unversioned key | Low (requires a code change) | Corrupt or discarded preference | Low |

**Nothing in this codebase looks likely to corrupt user data.** The queue — the one piece of genuinely user-owned state the client holds — is the best-defended thing in the repo: versioned in-payload, filtered for unplayable rows with the index slid to compensate (`PlayerContext.jsx:71-79`), flushed on unmount, and never overwritten by a restore the user has already overridden.

## Checked and found clean

- Server error handling end to end — middleware, sanitization, process guards. Correct and well-reasoned.
- `cacheTracks` unhandled-rejection exposure — none; catches internally per row.
- `installCrashLogger` / `Sentry.init` ordering — correct; Sentry wraps ours, both fire.
- The playback error-recovery ladder (`engine.js:690-814`) — class-aware, jittered, ceiling-bounded, offline-aware, and it re-checks that the user is still on the same track before punishing it (`:743`, `:803`). This is the strongest code in either repo.
- Queue op serialization (`opChain`) and the post-kill play retry.
- Both test suites pass at these HEADs: `native` 46 suites / 271 tests (43.9 s); `web` 70 files / 499 tests (48.7 s).
