# Optimization playbook — AURA

**A lookup table, not a checklist.** Nothing here gets applied because it appears here. Phase 7 attributes a measured cost to a cause; find that cause below and pick from the candidates. A technique with no measurement pointing at it is out of scope.

Every entry names its cost. Almost every real optimization is a trade, and naming the trade is what separates an engineering decision from a pattern match.

Scoped to this stack: React Native 0.83 / Hermes / New Architecture, MMKV-only client state, Express-on-Vercel, Neon Postgres in Singapore, Upstash Redis. **There is no local database on the client** — every query technique below is server-side.

---

## Principles that decide between candidates

**Remove work before making work faster.** Does it need to happen at all, then now, then here — before asking how to speed it up.

**Fix the cause, not the symptom.** A Redis layer over an unindexed query is an unindexed query plus an invalidation bug waiting to fire. Index it, then decide whether caching still earns its place.

**Algorithmic before micro.** An O(n²) in `renderItem` beats any amount of tuning around it.

**Identify the blocked thread before optimizing anything on the client.** RN jank is either the JS thread failing to produce updates or the UI thread failing to draw them. The fixes are disjoint, and a fix aimed at the wrong one is pure cost. Hermes sampling profiler tells you about JS; `dumpsys gfxinfo framestats` tells you about UI.

**Payload is a client cost, not just a server one.** A 4 MB JSON response is parse time, JS heap, and battery on the phone. Server query time is only half the number.

**Bound everything.** Caches, prefetch, parallelism, response length. Unbounded is a bug that hasn't met a large account yet — which is precisely this codebase's situation.

---

# Client — React Native

## Symptom: slow cold start

| Technique | Cost / when it's wrong |
|---|---|
| Inline requires / lazy module loading so the bundle isn't fully evaluated at launch | Deferred cost reappears at first use; can surface as a mid-session stall |
| Lazy TurboModule init — don't initialize native modules not needed for first frame | `AuraEqualizerModule` must still be ready before audio session attach |
| Lazy-mount navigation screens; avoid mounting every tab up front | First navigation to a screen becomes slower |
| Audit top-level side effects in eagerly-required modules | — |
| **Restore position from MMKV before any network call.** MMKV reads are synchronous and fast; a Singapore round-trip is not | Restored state may be stale — needs a reconcile pass after the network answers |
| Hold the splash only to first *meaningful* paint, not to full hydration | Skeleton must not cause layout shift |
| Verify Hermes bytecode precompilation is actually on in release | — |
| Trim bundle size; audit for heavy deps pulled in at module scope | — |

## Symptom: scroll jank on long lists

`initialNumToRender: 14` / `windowSize: 3` are the current values. Treat them as untested assumptions, not settings — `windowSize: 3` is aggressive and trades blank-cell risk for memory.

| Technique | Cost / when it's wrong |
|---|---|
| **`getItemLayout` where rows are fixed-height** — skips measurement entirely and makes `scrollToIndex` instant | Only valid if height is genuinely uniform; wrong values break scrolling badly |
| `React.memo` on the row, with referentially stable props | Requires `useCallback` discipline on every handler passed down |
| No inline arrow functions or object literals in `renderItem` props — they break memoization every frame | Slightly noisier component code |
| Precompute display strings at load — formatted duration, joined artists — never per render | Fatter model in memory; must invalidate on locale change |
| Stable `keyExtractor`, never index-based | Requires a genuinely stable server ID |
| Tune `windowSize` / `maxToRenderPerBatch` / `updateCellsBatchingPeriod` **against measurements**, not by feel | Raising `windowSize` cuts blank cells and raises memory. The 361 MB figure that used to be cited here is **stale** — see below; the measured cost of 289 rows is **+37 MB** |
| `removeClippedSubviews` on Android | Known to cause disappearing-content bugs in some nesting; test hard |
| **FlashList as a candidate replacement for FlatList** | A dependency and a real migration. Only if measurement shows FlatList recycling is the bottleneck |
| Move list diffing off the JS thread, or avoid full-list state replacement on reorder | Needs generation tracking to reject stale results |

## Symptom: it works on my phone

The chapter this playbook was missing, and the one that cost the most.

`minSdkVersion` is **26**. The app has only ever run on API **30** and **34**.
On 2026-07-30 `glass.backdropRadius` was raised 20 → 40 to fix boxy seams
reported on the API 34 device. RenderScript's `ScriptIntrinsicBlur` throws above
25 and is the blur path below API 31 — so the app became **unlaunchable on API
26-30**, five major versions, first drawn frame, for eleven days. `reports/04-baseline.md:9-18`
documents an API 30 device and states its purpose is "isolating ROM and
**API-level behaviour**". It had simply stopped being run.

| Technique | Cost / when it's wrong |
|---|---|
| **Clamp per branch, never share a constant across an API split.** A value tuned for the modern path is not a default for the legacy one | Two constants to keep in step; worth it — the equalizer's boost ceiling already does this with three independent clamps and a test, and has never broken |
| **Run the device matrix after any native or API-branched change** (`.github/workflows/device-matrix.yml`) | Minutes of emulator time. Catching a first-frame crash needs only install-and-see-if-it-lives |
| Tag telemetry with the API level so a defect can be *sliced* by it, not just found | One tag; without it you are querying vendor default contexts instead of your own facets |
| **Distrust a branch nobody runs.** Grep `Build.VERSION.SDK_INT` and `Platform.Version` and ask which side of each has ever executed | Cheap. The sweep that found the blur bug found six more candidates |
| Watch the *modern* branch too — `targetSdk` moves the defaults under you | Predictive back and edge-to-edge enforcement both change behaviour on devices newer than the test phone. Same bug, branches swapped |
| Check real reach, not nominal reach | `reactNativeArchitectures=arm64-v8a` means 32-bit-only devices cannot install at all, whatever `minSdk` claims |

**Optimization debt specific to this symptom:** any constant whose justifying
comment names an API level without branching on it; any device in
`reports/04-baseline.md` that has not been launched since the last native
change.

## Symptom: JS thread blocked / dropped state updates

| Technique | Cost / when it's wrong |
|---|---|
| Narrow store selectors so a write doesn't re-render unrelated subtrees | More selector boilerplate |
| Check Context value identity — a new object each render re-renders the whole consumer tree | Memoizing context values can hide staleness bugs |
| Batch or debounce high-frequency state writes, especially playback position | Position UI lags; drive from RNTP events rather than polling |
| Move heavy pure computation off the render path entirely | — |
| Consider React Compiler if available on this React version | Build config; verify it actually helps before adopting |

## Symptom: drag-reorder jank

| Technique | Cost / when it's wrong |
|---|---|
| **Confirm the gesture path stays on the UI thread** — a `runOnJS` inside the active gesture worklet drops it to JS-thread speed and is the usual cause | Some state must reach JS; do it on drop, not per frame |
| Commit reorder state once on release, never per movement frame | Optimistic UI must reconcile if the server rejects |
| No layout animations on non-adjacent rows during the drag | Less polished motion |
| Keep list item components memoized so a drag doesn't re-render every row | — |
| Persist to MMKV and POST to the server **on drop only** | A drop lost to a crash reverts the reorder |

## Symptom: high memory

> **The 232 → 361 MB spike this section used to be named after is stale, and it
> was load-bearing for years of decisions.** It was measured against the
> `ScrollView` implementation that `LONG_LIST` replaced. Re-measured on the same
> device after windowing landed, opening a 289-track playlist costs **+37 MB**
> (`reports/04-baseline.md:72`, `reports/01-stability.md:135`). The only
> *observed* kill point is **741 MB PSS** on device A under ColorOS 14
> (`reports/10-leak-and-kill.md:19-28`) — one event, one ROM. And ~78 MB
> retained after a 289-row browse is still unattributed
> (`reports/05-attribution.md:23-32`); the bitmap-cache hypothesis was refuted
> (`reports/08-spotted.md:45`) and `am dumpheap` was never run.
>
> Quoting a superseded number to block a change is the failure mode this note
> exists to stop.

| Technique | Cost / when it's wrong |
|---|---|
| **Artwork is the usual bulk.** Resize to display dimensions rather than caching full-resolution; set an explicit cache size cap | Re-fetch or re-decode when shown larger elsewhere |
| Hold trimmed row models — id, title, artist, artwork URI, duration — not full server track objects | A second fetch when the full object is needed |
| Cancel in-flight image loads on row recycle | Wasted work if the row scrolls back immediately |
| Raise `windowSize` only after confirming artwork isn't the driver | Directly increases retained rows |
| Audit MMKV value sizes — it's mmap'd, and large blobs are real resident memory | Splitting keys costs read complexity |
| Check for retained subscriptions and RNTP listeners across screen unmounts | — |

## Symptom: slow tap-to-audio

| Technique | Cost / when it's wrong |
|---|---|
| **Never resolve the stream URL on the tap.** Pre-resolve for the current and next track | Wasted resolution for tracks never played; upstream URLs may expire — check TTL |
| Keep the RNTP player instance warm rather than constructing on demand | Holds audio resources; small idle battery cost |
| Tune Media3 buffer-before-playback in vendored `kotlin-audio` | **Direct trade against rebuffering.** 320 kbps AAC ceiling means bandwidth need is fixed and known — measure stall rate on a throttled connection before shipping any reduction |
| Prepare exactly one track ahead | Data and battery for a skip that may not come |
| Keep the play path free of network round-trips to Singapore | Requires the queue to be hydrated in advance |

## Symptom: battery drain / screen-off failures

| Technique | Cost / when it's wrong |
|---|---|
| Drive position UI from RNTP events, not a polling interval; stop updates entirely when the screen is off | Position may lag briefly on resume |
| Hold no wakelock beyond what the foreground service requires | Under-holding risks the exact ColorOS kill you're trying to survive — test both directions |
| Write restore state to MMKV synchronously **before** backgrounding, not on a timer | Slight cost on every background transition |
| Batch deferrable background work | Less timely updates |

---

# Server — Express on Vercel, Neon Postgres

## Symptom: unbounded responses (`listLiked`, playlist-tracks)

| Technique | Cost / when it's wrong |
|---|---|
| **Add LIMIT with keyset (cursor) pagination**, matching the pattern history already uses | Client must handle paging on four more screens; this is the real fix and it isn't small |
| Return only displayed columns; payload size is a mobile cost | More query variants to maintain |
| Response compression | Negligible; usually already on at the platform |
| Cap at a hard maximum even with pagination | An account above the cap needs a defined behavior — decide it explicitly |

## Symptom: slow queries

| Technique | Cost / when it's wrong |
|---|---|
| Index the columns actually filtered and sorted — **verify with `EXPLAIN ANALYZE`, never by inspection** | Index size, slower writes |
| Remove N+1 patterns via join or batch | Larger, less readable queries |
| Avoid `LIKE '%term%'` for search — a leading wildcard cannot use an index at all. Use `pg_trgm` or full-text | Index size and write cost |
| Keyset over `OFFSET` for deep pages | More complex cursor handling |

## Symptom: serverless cold starts and connection problems

| Technique | Cost / when it's wrong |
|---|---|
| **Use Neon's pooled endpoint, not the direct one.** Per-invocation connections exhaust the pool under concurrency and won't show up in low-traffic testing | pgBouncer transaction mode restricts prepared statements and session state |
| Reuse the client at module scope so warm invocations don't reconnect | Must handle a dead connection on reuse |
| **Consider Neon's HTTP/serverless driver for single-shot queries** — skips the TCP handshake entirely, which is most of the cold-start query cost | No transactions or session state over HTTP |
| Lazy-require heavy deps — `firebase-admin` and `resvg` are expensive to import at module scope | First use pays the cost |
| **Colocate the Vercel function region with Neon Singapore** | Adds RTT per query if mismatched; check where users actually are before moving either |
| Trim function bundle size | — |

## Symptom: repeated identical work

| Technique | Cost / when it's wrong |
|---|---|
| Cache read-heavy endpoints in Upstash with explicit invalidation on write | **Only after the query is indexed.** Caching an unindexed query hides it and adds a staleness bug |
| Pipeline Upstash commands — it's HTTP, so per-command latency is real | — |
| TTL discipline and stampede protection on hot keys | Complexity |

---

## Optimization debt — flag these for removal

- Caching over a query that should have been indexed
- Any cache without a size cap or eviction policy
- `runOnJS` inside an active gesture worklet where it isn't required
- Inline lambdas and object literals in memoized row props, defeating the memo
- Prefetch fetching materially more than is ever used
- Work moved off-thread that the caller then immediately blocks on
- `windowSize` or batching values tuned by feel, with no measurement behind them

---

## Correctness constraints that outrank every technique here

Nothing ships that risks:

- **Audio dropouts or underruns.** Worse than any latency number in this file.
- **Drift between the MMKV cache and the server**, which is authoritative.
- **The wrong track playing**, or playback restarting, skipping, or gapping as a side effect.
- **Loss of screen-off survival through a ColorOS kill cycle**, or of offline cold-start restore.
- **A change to the API contract** that ships to one repo and not the other.

A proposal that trades against any of these comes to me with the trade stated. I decide, not you.
