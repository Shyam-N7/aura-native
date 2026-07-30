# Spotted during Phase 5 — not actioned

Things found while implementing the approved queue. Per the rules these are recorded and left alone.

---

## SP1 — **WITHDRAWN.** The "background playback memory leak" was my measurement error

I reported a critical, fleet-wide, playback-killing memory leak. **It does not exist.** Recording the whole arc because the error is more instructive than the non-finding.

### What I claimed

A first soak on the OnePlus 6T (release build, screen ostensibly off, private session on) showed `TOTAL PSS` climbing linearly from 513 MB to **1,141 MB over ten minutes** — ~70 MB/min, no plateau. I called it the root cause of criterion 3, reasoning that a 5.4 GiB ColorOS device would cross its `lowmemorykiller` threshold in five to seven minutes, which matches the field reports.

### Why it was wrong

**My soak script logged pid, audio state and PSS — but never screen state.** I sent `KEYCODE_SLEEP` and assumed it took. AURA's home screen animates continuously (gradient, ribbon, quick-picks wheel, Skia), so a phone that stayed awake renders for ten minutes and climbs exactly like that, with no leak involved.

Three runs, same device, same build:

| Run | Protocol | Screen verified? | Result |
|---|---|---|---|
| 1 | Heavy UI, then play, then sleep | **No** | 513 → 1,141 MB (~70 MB/min) |
| 2 | Fresh process, play, sleep | No, but minimal UI | 203 → 235 MB (~4.5 MB/min) |
| 3 | **Run-1 protocol, wakefulness + `mScreenState` logged every minute** | **Yes — `OFF` / `Dozing` throughout** | 254 → 280 MB, oscillating, **plateaus** |

Run 3 reproduces run 1's setup exactly and adds the one measurement I had been missing. It plateaus. The leak is not there.

I also cited the earlier RMX3371 run (314 → 403 → 551 MB, then process death) as corroboration. That was doubly wrong: **that run is known-contaminated** — `screen_toggled: 1` at 11:42:07, three minutes in — and it shared the same unlogged assumption. Two runs resting on one unvalidated assumption is one observation, not two, and I should have seen that before writing "critical".

### The actual finding, which is good news

**Memory during genuine screen-off background playback is flat.** OnePlus 6T, release build, screen confirmed `OFF`/`Dozing`, audio confirmed rendering (`state:started`) for seven continuous minutes: PSS oscillates between 241 MB and 295 MB and settles at ~280 MB. Category breakdown over that window (run 2) shows the graphics buckets pinned — EGL mtrack flat at 28 MB, Gfx dev at 16 MB, Views at 288, Activities 1, AppContexts 8 — i.e. nothing accumulating.

That is a **positive result for criterion 3** on this device and ROM, and it is the first clean screen-off measurement this project has.

### The process lesson, which is the real deliverable

A measurement that does not verify its own preconditions is not evidence. The soak script asserted "screen off" by *sending a keyevent*, not by *reading the state back* — and every downstream conclusion inherited that gap. Any future soak logs `mWakefulness` and `mScreenState` per sample, and any finding built on a single unreplicated run gets reproduced before it gets a severity.

---

## SP2 — `MainApplication.kt` already carries significant memory work I had not seen

Not a defect — recording it because it **corrects a claim in `reports/02-review.md` (P2b)**. I attributed the ~78 MB retained after browsing a 289-track playlist to "the decoded-bitmap cache, unbounded and never evicted". The caches are explicitly bounded — Fresco 24 MB, Coil 8 MB — with `onTrimMemory` clearing both from `TRIM_MEMORY_RUNNING_LOW` up, and the comments cite prior measurements and the OOM-kill history. P2b's proposed mechanism is wrong. The 78 MB measurement itself still stands and remains unattributed.

## SP3 — two different `artUrl` helpers

`src/playback/engine.js:34` defines a local one rewriting to `500x500` for notification artwork; `src/utils/artUrl.js:3` exports a different one defaulting to `150x150` for list rows. Same name, same regex approach, different defaults, neither imports the other. Also an Open Question in `reports/02-review.md`.

## SP4 — `cmd media_session volume --set` is ColorOS-specific breakage

Silently no-ops on the RMX3371 (reports success, value unchanged) but works correctly on the OnePlus 6T / OxygenOS 11. The constraint recorded previously as general is device-specific.

## SP5 — two web tests are load-sensitive, not deterministic

`server/cardArt.test.js > renders a real PNG with the bundled font` and `src/screens/OnboardingScreen.test.jsx > gates each step…` both fail with `Test timed out in 5000ms` when the suite runs alongside a gradle build; both pass in isolation and on an unloaded machine. Neither has an import path to anything changed in this phase. Flaky under CPU contention rather than broken — but a 5 s timeout on a test doing real PNG rendering is thin, and CI will hit it.

## SP6 — RN Firebase ships an empty `default_notification_channel_id`

Found via a manifest-merger failure while implementing C2. `react-native-firebase_messaging`'s own manifest declares `com.google.firebase.messaging.default_notification_channel_id` with an **empty value**. That is the mechanism behind C2: the SDK read `""` as the app's default channel and fell back to its own. Resolved within C2 by `tools:replace="android:value"`, mirroring what `default_notification_color` already does in the same file.

- **jest workers force-exited once per full run** ("worker process has failed to
  exit gracefully… active timers") — pre-existing: fires identically with and
  without the 2026-07-30 leak-fix diff (A/B'd both ways, 272/272 green both
  ways). Some suite leaves a live timer at teardown; `--detectOpenHandles` run
  not done (out of scope mid-leak-fix).
