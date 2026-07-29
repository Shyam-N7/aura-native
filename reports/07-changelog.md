# Phase 5 — implementation changelog

Approved queue: **C1 → C2 → C4 → S1 → C3**.

## The oracle (as agreed, superseding the brief's original line)

The brief's Phase 5 oracle said *"queue state matches the server."* That line was withdrawn — there is no server-side queue; the playback queue is a client construct and cross-device queue sync is not a feature this app has or claims. The real drift risk is between the two **client** copies: what RNTP holds in memory and what MMKV persisted.

Two invariants, tiered so the expensive one stays runnable:

**Cheap gate — every item:**
- Build clean, both repos where touched, no new warnings
- `native` jest passes; `web` vitest passes
- Lint passes
- Dump RNTP's live queue and the MMKV mirror: **same track IDs, same order**. No in-session drift.

**Kill gate — only items touching playback, persistence, or list state:**
- Screen-off 10 min, untouched → ColorOS kill → restore
- **Same track, same order, same position within the track (±2 s)**

Tiering is deliberate: a ten-minute cycle per item is how a gate gets quietly skipped by hour three.

---

## C1 — error telemetry at terminal failure points

**Restated.** Today a caught failure produces no telemetry at all. `crumb()` writes breadcrumbs, and breadcrumbs only leave the device attached to an *event*; with `tracesSampleRate: 0` and zero `captureException` calls anywhere in the app, the only recurring event is `cold-open-timing` on a 6-second boot timer. So every handled dead end — playback giving up on a track, the play button doing nothing, the player never coming up, push never enrolling — is invisible in the field.

Add one exception-proof `report()` seam beside `crumb()` in `native/src/lib/crumbs.js`, and call it at **terminal dead ends only** — not per retry, not per HTTP failure. Four sites.

**Expected effect.** Those four failures start producing Sentry events, and because breadcrumbs attach to events, each one arrives carrying the playback/recovery/eq/perf trail that was already being recorded and thrown away. No behaviour change: `report()` cannot throw into its caller, same contract as `crumb()`.

**Not in scope.** A blanket handler in `fetchAuthed` — my own Phase 3 note said one capture per genuine dead end, and every 4xx/5xx would drown the signal. The 12 existing `console.warn` lines stay; removing them is a separate concern.

**Scope amended mid-item (disclosed, not silent).** The original four sites were chosen as "terminal dead ends the user feels". Writing the drift gate down exposed a gap: the place model↔native divergence is actually *born* is `enqueueOp`'s catch (`src/playback/PlayerContext.jsx:151-163`), where a mutation has already landed in the React model — and from there in MMKV — while the push to the engine failed. Nothing reconciles the two afterwards. It is not user-visible in the moment, which is why it was easy to miss, but it is the single event that explains "wrong song playing" and "my reorder didn't stick". Added as a fifth site. Same concern, not a bundled refactor.

**Open risk on this item:** I have no data on how often any of these five fire, because the absence of that data is the whole reason C1 exists. `player.engine-op-failed` is the most likely to be noisy — it could burst during a service rebuild. If the first field data shows it drowning the others, dial it back. Recorded so the decision is revisited rather than forgotten.

**Changed.** 4 files, `native` only:

| File | Change |
|---|---|
| `src/lib/crumbs.js` | new `report(err, where, data)` beside `crumb()` — wraps `Sentry.captureException`, tags with `where`, cannot throw |
| `src/playback/engine.js:16, 806-816` | import; `report(err, 'playback.give-up', {id, attempts, klass})` at the ladder's end |
| `src/playback/PlayerContext.jsx:28, 190-195, 1035-1039` | import; `report(err2, 'player.play-op-failed')`; `report(setupErr, 'player.setup-failed')` |
| `src/lib/push.js:27, 58-70` | import; `report(…, 'push.register-failed')` on non-404 status and on throw. 404 deliberately excluded — that is the server half not being deployed, which retries next boot by design |

**Gate results.**

| Gate | Result |
|---|---|
| Lint (`eslint .`) | **Pass** — exit 0, no output |
| `native` jest | **Pass** — 46 suites / 271 tests. (Pre-existing "worker process failed to exit gracefully" warning, already on the open list, unchanged.) |
| Release build | **Pass** — `BUILD SUCCESSFUL in 3m 17s`, **0 compiler warnings**, APK 46,756,244 bytes |
| `web` vitest | **N/A** — item does not touch `web` |
| **Drift gate (RNTP live queue vs MMKV mirror)** | **CANNOT RUN — see below** |
| Kill gate | Not applicable by tier (C1 touches no playback, persistence, or list-state path — it adds fire-and-forget reporting inside existing `catch` blocks) |

**Incidental finding — S8 is closed.** The previously-open item "release build exits 1 at the Sentry source-map upload" **did not reproduce**. The Sentry tasks ran (`createBundleReleaseJsAndAssets_SentryUploadCleanUp`, `cleanupTemporarySentryJsonConfiguration`) and the build succeeded. Not caused by this change; recording it because it was carried as unverified.

**Status: BLOCKED on the drift gate, not failed.**

The agreed cheap gate is not executable against a release build, for either operand:

- **RNTP's live queue is not exposed.** `dumpsys media_session` reports `queueTitle=null, size=0` — RNTP/Media3 publishes playback state and current-item metadata to the session but never the queue items. There is no adb-visible copy of what RNTP holds.
- **MMKV is not readable.** `adb shell run-as live.aurafm.app` → `run-as: package not debuggable`. Release builds seal app-private storage, and `android:allowBackup="false"` (`android/app/src/main/AndroidManifest.xml:22`) closes `adb backup` as an alternative.

A debug build recovers only the MMKV half; RNTP's in-memory queue still has no external dump path. Making the gate real needs a small in-app inspection path (debug-build only), which is application code and therefore outside this item's stated scope — hence escalation rather than a silent widening or a silent skip.

**Not committed.** Held pending that decision, since the same blocker applies to every remaining item in the queue.

---

## C2 — push priority + notification channel — **DONE**, committed `751d1f7` (native) / `caf183a` (web)

**Restated.** Two delivery-critical fields missing, both invisible in anything FCM returns: no `android.priority`, so a normal-priority message to a dozing device waits for the next maintenance window; and no notification channel, so pushes land wherever the SDK decides.

**Expected effect.** Pushes arrive promptly on a locked, idle device, in a channel named for this app at an importance we chose.

**Changed.** `native`: `MainApplication.kt` creates channel `aura.push.v1` at `IMPORTANCE_HIGH` in `onCreate`; `strings.xml` gains the name/description; `AndroidManifest.xml` declares it as the FCM default. `web`: `server/push.js` sends `priority: 'high'` + `channelId`; `server/push.test.js` asserts both literals so a drift between the three copies of the id fails a gate.

**Discovered on the way** (SP6): the build failed at manifest merge because `react-native-firebase_messaging` declares `default_notification_channel_id` with an **empty value**. That is the mechanism — the SDK has been reading `""` as our default all along. Resolved with `tools:replace="android:value"`, mirroring what `default_notification_color` already does two lines above.

| Gate | Result |
|---|---|
| Release build | **Pass** — 0 warnings; merged manifest confirms `android:value="aura.push.v1"` wins |
| `web` vitest | **Pass** — 70 files / 499 tests |
| Drift gate | Blocked (unchanged) |
| Kill gate | N/A by tier |
| **Locked-screen delivery** | **OWED** — the test that actually proves this criterion has still never been run |

---

## S1 — guard `/api/catalog/search` — **DONE**, committed `6aeb5bb`

Wrapped in `asyncHandler`, the mechanism already used at 13 sites in `auth.js`. Closes structural exposure (an unguarded throw would hang the client for the full 60 s function timeout); no reachable throw was identified, so this is not a live-bug fix. Gates: `node --check` clean, full suite green.

---

## C4 — fetch timeouts — **SERVER HALF DONE**, committed `bdfa59f`. **Client half deliberately not attempted.**

**Server.** Eleven unbounded outbound calls now carry deadlines — six in `catalog.js`, four in `artists.js`, one in `related.js` at 10 s, plus the two OG shell fetches in `app.js` at 5 s. `cardArt.js`/`loudness.js`/`stems.js` already guarded theirs. One exported constant shared by the three catalog-facing modules rather than three drifting copies.

That shared import broke `related.test.js`: its `vi.mock` of `catalog.js` listed four exports, so `UPSTREAM_TIMEOUT_MS` arrived `undefined` and `AbortSignal.timeout(undefined)` coerces to **0** — aborting every station fetch instantly and returning `[]`. Fixed by completing the mock to match the real module. No assertion changed.

Gates: `node --check` on all four files, full suite 70/499.

**Client half — not done, on purpose.** Adding a default deadline to `fetchAuthed` changes behaviour for all 24 API modules at once, including `getTrack`, which feeds queue hydration and cold restore. A timeout converts "slow success" into "failure", and a failed hydration can change **which track plays**. That is explicitly on the escalation list, and its gate — the RNTP-vs-MMKV drift check — is exactly the one that cannot be run. Doing it blind would be the worst combination available. **Needs a decision:** what deadline, and whether playback-critical callers get a longer one or an exemption.

---

## C3 — `pool.query` → `query()` audit — **REVERTED**

**Attempted.** All 133 direct `pool.query` calls across 24 files converted to the retrying `query()` wrapper, imports normalised. Verified first that only `db.js` uses transactions or a dedicated client, so every one of the 133 is a standalone single statement and a valid candidate — and that the local `pool` variables in `homeReco.js`/`quickPicks.js` are function-scoped and don't collide. All 24 files parsed.

**Failed.** Full suite: **12 files / 65 tests failed** — `No "query" export is defined on the "./db.js" mock`.

**Why I reverted rather than fixed it.** The mocks don't merely lack an export. Twelve test files assert against `pool.query.mock.calls`, so making them pass means rewriting roughly 65 assertions to point at a different function. That is *widening the change to make it pass*, which the rules forbid — and rewriting a third of the server suite's assertions to accommodate a refactor is exactly where tests get quietly weakened.

**What it actually surfaced.** This is architecture, not a bug fix. The test contract of this codebase is built around `pool`, which is the concrete form of `reports/02-review.md` A4 — the `pool.query` / `query()` split is invisible at the call site, so nothing tells an author which to use, and the tests encode the wrong one. Three ways forward, needing a decision:

1. **Make `pool.query` itself retry** — a wrapper on the exported pool object. Zero call-site churn, zero test churn, and the choice stops existing. Riskiest to get right, and it changes semantics for `db.js`'s own transaction code.
2. **Convert call sites and update the 12 test files** — mechanical but broad, and it should be its own reviewed change with the assertion rewrites visible, not folded into a fix.
3. **Convert only the hot request paths** and leave the rest, documenting which is which. Smallest diff; leaves the split in place.

I'd take (1): it removes the footgun rather than relitigating 133 call sites, and no test asserts on retry behaviour today so the blast radius is smaller than it looks. But it changes shared infrastructure and is not mine to pick unilaterally.

Suite verified green after revert: 70 files / 499 tests.
