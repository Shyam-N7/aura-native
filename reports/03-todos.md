# Phase 4 — TODO triage

`native` @ `027ee93`, `web` @ `32d185d`.

## The scan

Every `TODO`, `FIXME`, `HACK`, and `XXX` across both repos, excluding `node_modules`:

| Scope | Files searched | Markers found |
|---|---|---|
| `native/src/` + `App.jsx` + `index.js` | `*.js`, `*.jsx` | **0** |
| `native/android/app/src/` + `native/android/kotlin-audio/` | `*.kt` | **1** |
| `web/server/` + `web/api/` | `*.js` | **0** |
| `web/src/` | `*.js`, `*.jsx` | **0** |

**One marker exists in either repo.**

| Repo | File | Line | Text | Classification |
|---|---|---|---|---|
| `native` | `android/kotlin-audio/src/main/java/com/doublesymmetry/kotlinaudio/models/QueuedPlayerOptions.kt` | 18 | `// TODO: Figure out a way for this function to be outside of this data class` | **Dead — not ours.** Upstream doublesymmetry/kotlin-audio code, carried in unmodified. It is a style note about Kotlin data-class ergonomics, touches no AURA behaviour, and sits in a file with no `AURA` divergence marker. Deleting it would create fork drift for zero benefit. Leave it. |

There is nothing to triage. No stale markers, no dead markers, no marker that is a bug in disguise, no entanglement with Phase 2 or Phase 3 findings, no dependencies, no conflicts.

**That is the finding.** A codebase this size (≈24,800 LOC native JS + ≈10,174 LOC server JS + a 29-file Kotlin fork) with zero self-reported debt in application code is unusual, and it means the marker-based backlog is not where this project's open work lives. It lives in prose docs and in things that were built and never verified.

---

## Open work not marked by any TODO

The brief names two explicitly. Both are real and both are correctly described as open.

### 1. The drag-to-queue interaction spec

**Status: written, mostly satisfied, and the doc is now stale.**

The spec exists as an audit table at `native/docs/perf/04-features.md:3-21` — eight interaction requirements for reorderable Up Next, each marked against the implementation in `native/src/overlays/QueueSheet.jsx`. Seven are marked ✅ and I found no reason to doubt them: the grip pan blocking list scroll, drop → `reorder(from,to)` → `engine.syncQueue` rebuilding around the active item, "play next" via the track menu, mount-window widening during drag.

**But the doc is out of date in a way triage should catch.** `native/docs/perf/04-features.md:19` marks `"move to top"` as **❌ not present**, and `:21` lists it under "Remaining work". It shipped. It is at `native/src/overlays/QueueSheet.jsx:1042-1045` (the `moveToTop` callback), wired into the row menu at `:523` and passed down at `:1355`, with the same "next in line, right after the playing track" semantics the doc proposed.

So the doc's "Remaining work: move-to-top row action; a 500-item `gfxinfo` frame pass" is half wrong. **Classification: real-and-small — a documentation correction, not code.**

One further item in that spec is worth re-reading before anyone calls it closed: the drop-line rendering was fixed after that doc was written (the reference line now shows for the whole drag, including while the target still equals the row's own index). The audit table does not mention drop-line behaviour at all, so the spec is silent on something that turned out to be the hardest part of the interaction to get right.

### 2. The 500-item frame-timing acceptance test

**Status: specified, never run, and blocked on a missing test hook.**

Named in two places: `native/docs/perf/04-features.md:17` ("**500-item frame-timing pass still owed** (`dumpsys gfxinfo` while dragging a long synthetic queue)") and `:84`, which records the blocker — it "needs a dev hook to inject a synthetic queue".

**Classification: real-and-large.** Not because the measurement is hard, but because of what it requires:

- **A synthetic-queue injection hook.** No user has a 500-track queue to test with, so the app needs a way to build one. That is application code, which puts it after Phase 5, not in it.
- **A real finger.** `adb` cannot drive a gesture-handler pan — `input swipe`, `draganddrop`, and `motionevent` have all been tried and all land as taps. The drag must be performed by hand while `gfxinfo` records.
- **A device that proves something.** Per the standing constraint, a 60 fps drag on SM8250 silicon does not tell you a 500-row drag is fine anywhere else. This test on this phone answers a narrower question than it appears to.

**Entanglement:** this is the acceptance test for Phase 6's "Frame time, 500-row drag-reorder" row, which the brief marks as *the never-run test*. It cannot be run in Phase 6 as currently scoped, because Phase 6 permits measurement-harness code only and the injection hook is closer to a debug feature. **This needs a decision from you** — see the queue below.

### 3. `clearTrackCache` — resolved by history: **test-only, with an overclaiming comment**

Raised as an open question in `reports/02-review.md`. `git log -S` settles it.

- It arrived in **`765befb`** — *the same commit that introduced the track cache itself*. Not vestigial: it never had a production caller that was later deleted.
- It is **not** dead either. It has exactly one caller: `native/__tests__/trackCache.test.js:2,23`.

So it is neither bucket. It is legitimately-used test infrastructure whose doc comment (`native/src/api/catalog.js:106-108`) claims more than it delivers: *"it exists for tests and for a future storage-panic escape hatch."* The first half is true and exercised. The second half describes a hatch that was never built, never wired, and has never executed.

**Classification: real-and-small — a comment defect, not a code defect.** The function stays; it has a caller and a test. The escape-hatch clause should come out of the comment, because a documented-but-nonexistent recovery path is worse than silence — it reads as available. If a storage-panic hatch is genuinely wanted, that is a separate feature with its own caller and test.

### 4. Other unverified-but-built work (no marker, not in any doc's remaining-work list)

Carried from prior sessions and still true at this HEAD. Listing them here because they are the same category as the two above — built, unconfirmed:

- Backgrounded push arriving on a locked screen (Phase 2, criterion 2 — now with two concrete config causes, C2).
- Repeat-play served from the ExoPlayer disk cache.
- The equalizer's refusal behaviour when an OEM effect owns the session, with Dolby on vs off.
- Volume boost, judged by ear.
- The new failure UI paths: offline home, prefs error, history retry.
- Whether the recovery guard is too cautious in practice.

---

## TODOs now, or stability first?

**Stability first. The TODOs are not the problem — there aren't any.**

That is not a rhetorical flourish; it is the literal scan result, and it changes the shape of the answer. The question "should we work the TODOs" presumes a backlog of self-reported debt. There is one marker in both repos and it belongs to a vendored upstream library. Working it would accomplish nothing.

What the audit found instead is a different and more awkward class of problem: **shipped subsystems with no way to report that they are failing.** None of these would ever have appeared in a TODO list, because nobody knew to write one — that is precisely what C1 describes. The push gaps (C2) are the clearest case: two missing config fields that have plausibly been suppressing notification delivery for as long as push has existed, in a subsystem that reports nothing when it fails, discovered by reading the send payload rather than by any signal from the field.

So the order is dictated by dependency, not by preference. C1 comes first because every other diagnosis is blind until it lands. C2 comes next because it is small, it is almost certainly a live user-facing failure, and it is the first thing whose fix C1 will let you actually verify.

### Suggested order

**Correctness, in this sequence:**

1. **C1 — error telemetry** (`Sentry.captureException` at terminal failure points). Everything downstream is diagnosable after this and blind before it. Small.
2. **C2 — push priority + notification channel.** Small, high-probability live defect. Pairs with the on-device locked-screen test, which is the one test that settles criterion 2.
3. **C4 — fetch timeouts**, server and client. Small, bounded, removes a 60-second failure mode on both sides of the seam.
4. **S1 — guard `/api/catalog/search`.** Minutes.
5. **C3 — the `pool.query` → `query()` audit.** Medium, wide, touches auth; do it when the three above are done and telemetry can show whether it helped.

**Then measurement (Phase 6), and only then C5.** The unbounded endpoints are the largest item on the list and the one most likely to be over- or under-built if done on instinct. Phase 6 is supposed to establish real production scale — the p95 and max liked-track and playlist-track counts. If real accounts top out at 300 rows, C5 is a smaller job than the Critical rating implies; if they reach 5,000, it is bigger. **Do not start C5 before that number exists.**

**Deferred pending your decisions:**

- The 500-item drag test, pending the injection-hook question below.
- Everything in the "unverified-but-built" list, pending device access.
- A2 (what "queue matches the server" means) — this blocks Phase 5's oracle.

### Three things I need from you

1. **The synthetic-queue injection hook.** Phase 6 cannot run the 500-row drag test without it, and building it is application code, which Phase 6 forbids. Options: add it as an approved Phase 5 item, defer the test to a later phase, or drop the test. My recommendation is to add it in Phase 5 as a debug-only path — the alternative is that this test stays un-run for a third consecutive cycle.
2. **The Phase 5 oracle line "queue state matches the server."** There is no server-side queue to match against (`reports/02-review.md` A2). I need to know what to check instead — my suggestion is "queue survives the kill and restores to the same track and order", which is checkable.
3. **The device.** The phone is locked and audio volume cannot be lowered from adb on this ROM. Criteria 2, 3, and 5 all need it unlocked, and criterion 3 needs the volume down by hand.
