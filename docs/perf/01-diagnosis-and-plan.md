# AURA Native — Diagnosis & Fix Plan (Phase 1)

*Symptoms are fleet-wide (multiple users). Format per brief: symptom → suspected causes
with code evidence → what would disprove → runtime confirmation → fix → risk. Citations at
commit `7a7fdd7`; see `00-architecture-map.md` for the layer map.*

## 1. Playback stops mid-song

**Causes, ranked:**

**(a) No wake lock during network playback — CONFIRMED ABSENT → FIXED (1451ded).**
The vendored `PlayerConfig` now defaults `WakeMode.NETWORK`; the paragraph below
describes the state at diagnosis time. kotlin-audio
`PlayerConfig.kt:35` defaulted `WakeMode.NONE` and nothing set it. With the screen off,
Doze can sleep the CPU/radio mid-buffer; the buffer drains and playback stalls-stops. The
foreground service keeps the *process* alive — it does not keep the radio on. Fleet-wide
consistent (hits every device, worst on aggressive OEMs).
*Disproved if:* stops also happen with screen ON, or logs show the service was killed
rather than stalled. *Confirm:* `adb shell dumpsys deviceidle` state at stop time; logcat
ExoPlayer `STATE_BUFFERING`→idle with no error; reproduce with `adb shell cmd deviceidle
force-idle` mid-stream. *Fix:* set `WakeMode.NETWORK` in our vendored kotlin-audio's
PlayerConfig and plumb it from RNTP setup (patch). *Risk:* small battery cost while
streaming — bounded, ExoPlayer releases the lock when idle/paused.

**(b) OEM battery killers.** Documented history on ColorOS (o-kill; memory + three
signatures from the July road test). *Confirm:* breadcrumbs (see §3) recording service
`onDestroy` without user action; `dumpsys activity services` after a report. *Fix:*
battery-optimization exemption prompt (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` intent) +
OEM-specific guidance screen; cannot be fully engineered away. *Risk:* prompt fatigue —
show once, from settings.

**(c) Audio focus — CORRECTED during implementation: handled natively, not a gap.**
Initial recon flagged that `MusicService.kt:655-663` only emits `remote-duck` to JS and
`src/playback/` has no handler. Deeper trace: `engine.js:138` passes
`autoHandleInterruptions: true` → `handleAudioFocus = true` (`MusicService.kt:154`) →
`exoPlayer.setAudioAttributes(attrs, /* handleAudioFocus */ true)`
(`BaseAudioPlayer.kt:274`) — **ExoPlayer's built-in focus manager is active**: pause on
permanent loss, pause+auto-resume on transient, duck on can-duck. UI state stays in sync
because the native pause fires `PlaybackPlayWhenReadyChanged`, which PlayerContext
already consumes. The JS `remote-duck` event is informational only in this config.
*Residual check (device):* one manual pass — alarm + voice note during playback —
to confirm the ExoPlayer path behaves on ColorOS. No code change planned.

**(d) Expired stream URL mid-play.** Recovery EXISTS (`engine.js:549-566`, single-shot
URL refetch). *Confirm:* verify it resumes at the failed position, not zero, and count
recovery successes via breadcrumbs. *Fix:* covered by the Phase-3 retry ladder
(taxonomy + backoff + position preservation) layered on this hook.

**Not suspected:** becoming-noisy mis-fire (RNTP handles it; no reports of pause-on-
nothing), OOM (no evidence; crash tooling will tell).

## 2. Progress bar / position not restored after reopening

**Mechanism (traced, `PlayerContext.jsx:848-955`):** the engine restore is network-gated —
persisted tracks carry no streamUrl, so restore must `getTrack` over the network
(`:919-926`) before `syncQueue` seeks to `positionSec` (`:943-950`).

**(a) Perceived: bar shows 0:00 for seconds after open.** Until the round-trip returns,
RNTP has no queue and no position; the UI ticker has nothing to show. *Confirm:* cold
open on airplane-mode-then-wifi and watch how long the bar sits at 0.
**(b) Real loss: tapping play during the restore window discards the saved position.**
`userActedRef` (`:915/:927/:944`) makes the user's tap win by *abandoning* the restore —
the tap plays from index 0 position 0. Users who open the app and immediately hit play
lose their spot deterministically. *Disproved if:* users report loss WITHOUT touching
play — then look at write-side (5s debounce losing the last write on kill,
`PlayerContext.jsx:179-215`).
*RESOLVED (f344252):* deeper verification **disproved half of this** — `togglePlay`
already rebuilds with the saved position (`PlayerContext.jsx:496-503`), and error
recovery re-seeks `getProgress()` (`engine.js:558-598`), so (b) was downgraded to
display-only. The shipped fix: `usePlaybackProgress` seeds its first frames from the
MMKV snapshot (same guards as `storedPositionSec`) and retires the seed permanently
once the engine reports, so a genuine fresh start at 0:00 is never shadowed.

## 3. Crashes

No crash tooling exists (only local `src/lib/crashLog.js`). **First implementation task:
wire crash + ANR reporting with playback breadcrumbs** (track change, play/pause, error,
service rebuild, focus events, EQ attach) so §1/§2 hypotheses become measurable.

| | Sentry | Crashlytics |
|---|---|---|
| RN support | first-class SDK: JS + native + ANR, source maps | native-first; JS layer needs wrapper |
| Breadcrumbs API | rich, structured | basic custom keys/logs |
| Vendor | new | Firebase already shipped (FCM) |
| Cost | free tier ample at current scale | free |

**Recommendation: Sentry** (the breadcrumb quality is the point). Decision at approval.
Static audit for post-release access / swallowed callbacks folds into the same commit's
review checklist (the op-queue design already serializes most of it).

## 4. Equalizer only works with the screen on

**Prime suspect (code-confirmed mechanism):** effects attach to the ExoPlayer session id;
a service/player rebuild while backgrounded issues a NEW session id, silently detaching
effects; re-attach only fires on AppState `active` (`src/lib/equalizer.js:251-255`) — i.e.
**only when the screen comes back on**. Everything users describe falls out of that.
Secondary: OEM global DSP (ColorOS Dolby) stealing effect priority on route change.
*Disproved if:* EQ audibly dies with screen off *without* any rebuild (then it's effect
priority, check `dumpsys media.audio_flinger` for our session's effect chain).
*Confirm:* log session id per track + attach events; screen-off 10-min run.
*Fix:* emit an `audio-session-changed` event from the service side (vendored
kotlin-audio forwards ExoPlayer's `onAudioSessionIdChanged`; patch plumbs it) and
re-attach in the JS service handler — no AppState dependency. *Risk:* patch-package
maintenance; the event is additive.

## 5. Equalizer takes seconds to apply on the next track

The session id is per player *instance* — stable across track transitions; effects are
NOT torn down per track, and settings live in memory (`equalizer.js`, MMKV-backed
singleton). So "seconds on next track" implies one of: (a) a rebuild happened between
tracks (→ same root as §4; same fix); (b) the lazy attach path (`:299-307`) awaiting
`getAudioSessionId` + `attach` before pushing values — a bridge round-trip chain that is
tens of ms, not seconds, unless the session isn't ready. `applyAll` (`:189-210`) is ~7
sequential awaited bridge calls — measured cost expected <20 ms; will instrument to
confirm, not assume. **Session-id pinning across the queue** already holds by design;
the §4 fix closes the rebuild case. In-player audio-processor EQ (custom DSP) remains the
documented later path if system effects prove unreliable on more OEMs (tradeoff table in
the fidelity plan; deferred per earlier decision).

## 6. Opening a song takes seconds to reach playing

**Field reports (2026-07-28, user device, post-f344252):** (1) saved position now
renders instantly (fix confirmed); (2) tapping play after a cold open still takes
**2–3 s to audio** — consistent with the uncached catalog round-trip + prepare;
(3) **track transitions gap for seconds** instead of flowing — new symptom, prime
suspects: the next track's short-lived CDN URL expiring between hydration and the
transition (recovery refetch fires mid-gap), and/or prebuffering losing its work when
hydrateAround's replaceTrack swaps the upcoming item. Both feed the Phase-2/3 designs
directly.

**Instrumentation first** (per brief): timestamped stages behind a dev flag —
`app open → JS boot → setupPlayer → restore/getTrack round-trip → syncQueue →
prepare → first STATE_READY → first audio`. Expected dominator (code evidence): the
**catalog network round-trip** — every cold open refetches streamUrls
(`PlayerContext.jsx:919-926`), and every fresh pick resolves via `/api/catalog/track`
(server → upstream). Nothing plays from cache today: there is **no URL cache, no audio
cache, no prefetch-next**. Phase-2 doc designs that stack (URL cache with expiry +
ExoPlayer SimpleCache + next-track prefetch). Measure → then cache; budgets per the
brief's table, measured via `am start -W`, stage timestamps, and RNTP events.

---

# Phased implementation plan (order, effort, risk)

| # | Item | Effort | Risk | Depends on |
|---|------|--------|------|-----------|
| P1 | Crash/ANR + breadcrumbs (Sentry, pending approval) | S | low | — |
| P2 | Stage instrumentation + baseline numbers for all budget metrics | S | none | — |
| P3a | ~~RemoteDuck handling~~ — corrected: ExoPlayer handles focus natively (see §1c); device-verify only | — | — | — |
| P3b | WakeMode.NETWORK (kotlin-audio + RNTP patch) | S | low | — |
| P3c | EQ re-attach on session-change event (service-side) | M | med (patch) | P3b pattern |
| P3d | Restore race: instant UI position + play-tap carries positionSec | M | med | P2 numbers |
| P4 | Retry ladder (Phase-3 doc → impl) | M | med | P1, P2 |
| P5 | Caching stack (Phase-2 doc → impl: URL cache, SimpleCache, prefetch, art) | L | med | P2 numbers |
| P6a | Reorderable Up Next (syncQueue same-current tier is the engine) | M | med | — |
| P6b | Volume booster research → impl (headroom + limiter) | M | med | EQ stability (§4) |

One concern per commit; each step reports metric moved + verification. **Flagged extras
found during recon (not silently fixed):** no battery-exemption prompt anywhere; single-
shot error recovery with no taxonomy; every cold open pays a catalog round-trip by design.

~~**STOP — awaiting approval before any fix lands.**~~ Approved and shipped: P1–P6
all landed (see git log from 4e21980 onward). **P3c is the exception — it was never
built.** No `onAudioSessionIdChanged` forwarding, no `audio-session-changed` event,
no patch plumbing; the only session handling is the `getAudioSessionId` pull plus the
AppState re-attach in `lib/equalizer.js`. It appears to have been made unnecessary in
practice by P3b: with the wake lock held, the service stops being rebuilt, so the
session never changes and the EQ never detaches — which matches the field report that
the screen-off equalizer is fixed. What remains is latent, not live: `attached` is
never invalidated, so IF a session change ever did happen the EQ would go silently
dead with its switch still reading on.
