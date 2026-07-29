# Phase 6 — baseline

> **Read this line first: there is still no entry-tier device.** Every number below comes from flagship-class silicon. The second device added this session (OnePlus 6T) has **more** RAM than the first (7.5 GiB vs 5.4 GiB) and a 2018 flagship SoC. **No number here generalizes to a 3 GB phone.** The throttled-emulator column the brief asks for was not stood up.

All measurements: **release builds**, driven over adb. Debug/Metro numbers are excluded as the brief requires.

## Devices

| | **A — RMX3371** | **B — OnePlus 6T** |
|---|---|---|
| SoC | SM8250 (SD870 class, 2021) | sdm845 (SD845, 2018) |
| RAM | 5.4 GiB | 7.5 GiB |
| OS | Android 14 / API 34 | Android 11 / API 30 |
| Skin | ColorOS 14 | OxygenOS 11 |
| Screen | 1080×2400 | 1080×2340 @ 450dpi |
| adb serial | `5282743b` | `c3d6a2fe` |

Device B is **not** a lower tier — it is a different tier: older CPU, more memory, much lighter OEM skin, and an API level below the `POST_NOTIFICATIONS` threshold. It is useful for isolating ROM and API-level behaviour, not for establishing a performance floor.

---

## Results

| Metric | A (RMX3371) | B (6T) | Budget | Verdict |
|---|---|---|---|---|
| Cold start → first frame (`am start -W`, median of 3) | **502 ms** (907/502/453) | **289 ms** (291/287/289) | — | See note 1 |
| Cold start → position restored, offline | | | must not block on network | See note 2 |
| Tap play → first audio, warm | | | < 300 ms | **not measured** — note 3 |
| Tap play → first audio, cold | | | | **not measured** — note 3 |
| Seek → audio resumes | | | < 200 ms | **not measured** — note 3 |
| Frame time p50 / p95 / p99, long list | | **16 / 48 / 65 ms** (117 rows) | 16.7 ms | **misses** — note 4 |
| Janky frames, sustained scroll | | **645 / 1290 = 50.0%** | 0 | **misses** — note 4 |
| **Frame time, 500-row drag-reorder** | | | 16.7 ms, zero dropped | **NOT RUN** — note 5 |
| Audio underruns, 10 min playback | | **0** | 0 (hard) | **meets** — note 6 |
| PSS, idle after launch | 279–284 MB | **253 MB** | — | |
| PSS, long list open (peak) | **321 MB** (289 rows) | **329 MB** (117 rows) | confirm 232→361 | **premise corrected** — note 7 |
| PSS, after scrolling that list | **384 MB** | | | |
| PSS, after leaving the list | **362 MB** (views back to baseline) | | | note 7 |
| Memory over sustained background playback | | **254 → 280 MB, plateaus** (7 min, screen verified OFF) | flat, not monotonic | **meets** — note 8 |
| Battery, 1 hr background playback | | | | **not measured** |
| `listLiked` response time + payload, p95 / max real account | | | | **not measured** — note 9 |
| Playlist-tracks response, same | | | | **not measured** — note 9 |
| Vercel cold-start rate + function duration | | | | **not measured** — note 9 |
| APK size (release, universal) | | **44.6 MB** | — | |

### Production scale — partial

From the signed-in account (device B, read off the UI, not the database):

- **liked songs: 117**
- **playlists: 6**, largest **289 tracks**
- lifetime: 1,252 tracks played / 5,909 minutes

That is one account — the owner's, and therefore the heaviest user of the product. **It is not a distribution.** The p95/max query the brief asks for needs read-only access to the production Neon database, which I do not have. What it does establish: **the unbounded endpoints are not currently a live problem at this account's scale.** 117 liked tracks and a 289-track playlist are comfortably served in one response. The risk stays latent, as the brief said.

---

## Notes

**1 — the older phone starts faster, and that is the finding.** Device B (2018 SoC) cold-starts in 289 ms against device A's 502 ms, and B's three runs are within 4 ms of each other while A's spread across 907/502/453. Silicon does not explain that; the ROM does. ColorOS contention is the plausible cause, and it means **cold-start work should be validated against ColorOS specifically**, not against whatever is fastest. Both figures measure the activity's first frame, not a usable UI — RN bundle parse and first React render happen after.

**2 — half-answered, from Phase 2 rather than here.** The *display* restores with no network: `loadStoredQueue()` is a synchronous MMKV read in the `useState` initializer and `usePlaybackProgress` seeds the scrubber from MMKV. *Audio* is network-gated beyond `getTrack`'s 15-minute cache TTL. Measuring the split cleanly needs airplane-mode runs at both ends of that TTL; not run.

**3 — needs in-app instrumentation, not adb.** `am start -W` cannot see "first audio sample rendered", and polling `dumpsys audio` has ~1 s granularity — far too coarse for a 300 ms budget. `src/lib/perfMarks.js` already stamps boot stages and ships them to Sentry on every cold start at `SAMPLE = 1.0`. **Capture steps for you:** add `mark()` calls either side of the play path, then read the `boot-timing` context off recent `cold-open-timing` events in Sentry. That instrumentation already exists and its numbers have never been read — it is the cheapest measurement available in this project.

**4 — treat the jank number as suspect, and here is why.** 645/1290 janky, p95 48 ms, p99 65 ms — all past budget. But `Number Missed Vsync: 0`, `Number Slow UI thread: 0`, `Number Slow bitmap uploads: 0`, and GPU times are healthy (p50 6 ms, p99 11 ms). Meanwhile **`Number High input latency: 1290` — every single frame.** That is the signature of synthetic input: `adb shell input swipe` injects events whose timestamps the framework reads as arriving late, so every frame is classified janky on input latency alone. The *rendering* evidence says the opposite of the jank headline. **This number needs a real finger to be trusted.** Same limitation that blocks note 5.

**5 — still never run, and now blocked on two things.** The 500-row drag test needs (a) a synthetic-queue injection hook, which does not exist, and (b) a human finger, because adb cannot drive a gesture-handler pan — `input swipe`, `draganddrop` and `motionevent` all land as taps, proven four times now. Building the hook is legitimate Phase 6 harness work; driving it is not something I can do.

**6 — clean pass.** Seven continuous minutes of screen-off playback on device B with `AudioPlaybackConfiguration … state:started` sampled every 60 s: unbroken, tracks advanced normally (Apna Bana Le → Sahiba → Ae Dil Hai Mushkil), pid stable. No underrun observed. Ten minutes on the earlier run, same result.

**7 — the carried finding was measured against code that no longer exists.** `listWindow.js:3-6` cites 232 → 361 MB for a 245-track playlist; `PlaylistScreen.jsx:448-450` says that was "the old ScrollView map", replaced by the `LONG_LIST` bounds. Re-measured on device A with a **289**-track playlist: open costs **+37 MB** (284 → 321 peak), not +129 MB. **The windowing fix works.** Views recycle exactly — 539 → 1134 during scroll → **539** after leaving. But PSS did not return with them: 284 → 384 peak → **362 MB** after the views were gone, i.e. ~78 MB retained by something outliving the view tree. That remains **unattributed** — my first hypothesis (unbounded bitmap cache) was wrong, since `MainApplication.kt` caps Fresco at 24 MB and Coil at 8 MB with `onTrimMemory` clearing both.

**8 — and this one corrects a claim I made loudly.** Mid-session I reported a critical unbounded leak: 513 → 1,141 MB over ten minutes of background playback, ~70 MB/min. **It did not reproduce.** A third run using the same protocol but logging `mWakefulness` and `mScreenState` every minute — both `Dozing`/`OFF` throughout — plateaus at ~280 MB. The original soak script never verified the screen was actually off, so the likeliest reading of that 1,141 MB is a phone rendering an animated UI for ten minutes. Full write-up in `reports/08-spotted.md` SP1. **Background-playback memory is flat.**

**9 — server-side measurement was not attempted.** All three rows need production access I do not have: the Neon database for query timing and payload size at real account sizes, and the Vercel dashboard for cold-start rate and function duration. **Capture steps for you:** for the endpoints, `EXPLAIN (ANALYZE, BUFFERS)` on `listLiked` and the playlist-tracks query at production table size, plus `Content-Length` on the responses for the largest real accounts; for Vercel, the Functions tab gives invocation duration and cold-start percentage directly.

---

## What the blanks mean

Nine of the twenty-one rows are blank, and they are blank for three distinct reasons, which matter differently:

- **Needs production access** (rows: `listLiked`, playlist-tracks, Vercel) — you can fill these; I cannot.
- **Needs in-app instrumentation** (play latency, seek latency, offline restore split) — legitimate Phase 6 harness work that was not reached.
- **Needs a human finger or a device I don't have** (500-row drag, any 3 GB claim, trustworthy jank numbers) — structural limits, not omissions.

The brief said a blank cell is a correct answer. These are blank rather than guessed.
