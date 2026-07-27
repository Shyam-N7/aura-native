# AURA Native — Diagnosis & Fix Plan (Phase 1)

*Symptoms are fleet-wide (multiple users). Format per brief: symptom → suspected causes
with code evidence → what would disprove → runtime confirmation → fix → risk. Citations at
commit `7a7fdd7`; see `00-architecture-map.md` for the layer map.*

## 1. Playback stops mid-song

**Causes, ranked:**

**(a) No wake lock during network playback — CONFIRMED ABSENT.** kotlin-audio
`PlayerConfig.kt:35` defaults `WakeMode.NONE` and nothing sets it. With the screen off,
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

**(c) Audio focus is entirely unhandled — CONFIRMED GAP.** `MusicService.kt:655-663` only
emits `remote-duck` to JS; `src/playback/` has zero handlers for it. AURA never pauses for
calls/alarms and never resumes after; on some ROMs, ignoring focus marks the app for
killing. Also a plain correctness bug (plays over phone calls).
*Disproved if:* users report stops with no other audio event — (a)/(b) then dominate.
*Confirm:* trigger a WhatsApp voice note / alarm during playback and watch behavior +
event log. *Fix:* handle `Event.RemoteDuck` in `service.js`: permanent → pause; transient
→ pause + flag; gain + flag → resume. *Risk:* low — additive handler, mirrors RNTP docs.

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
*Confirm:* cold open → tap play within ~1s → position resets (repro); breadcrumbs around
restore/user-act ordering. *Fix (two independent commits):* (1) UI renders position/track
from the MMKV snapshot immediately at first frame (no engine wait); (2) the
play-during-restore path carries `positionSec` into its own syncQueue instead of
discarding it. *Risk:* (2) touches the restore race — needs the existing gapless-boundary
guard pattern (`:628-637`) and regression tests.

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
| P3a | RemoteDuck focus handling in service.js | S | low | P1 (verify via breadcrumbs) |
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

**STOP — awaiting approval before any fix lands.**
