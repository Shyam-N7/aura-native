# AURA Native — Architecture Map (Phase 0)

*Perf & reliability recon, 2026-07-27. Every claim carries a file:line citation; line
numbers are as of commit `7a7fdd7`.*

## Ownership chain

```
UI (React screens/overlays)
  └─ src/playback/PlayerContext.jsx   JS singleton provider: queue model, op-queue
     │                                serialization, position persistence, restore
  └─ src/playback/engine.js           RNTP wrapper: URL resolve, queue sync, recovery
  └─ src/playback/service.js          RNTP playback-service event handlers (headless)
  └─ RNTP MusicService (Kotlin)       foreground service, media session, notification
  └─ android/kotlin-audio             VENDORED gradle module we own — BaseAudioPlayer
                                      wraps ExoPlayer (we patched in audioSessionId)
```

- Playback is owned by the **foreground service** (RNTP `MusicService`), not any
  Activity. The JS layer is a *client* of it; JS death with `ContinuePlayback` leaves
  audio running, and boot re-adopts live state (`PlayerContext.jsx:896-909`).
- All engine mutations are serialized through an **op queue**
  (`enqueueOp`/`enqueuePlayOp`), which also survives service rebuilds
  (`PlayerContext.jsx:140-150` retries a failed play op once after rebuilding).

## Foreground service & locks

- Service declared by RNTP's own manifest with
  `foregroundServiceType="mediaPlayback"` (react-native-track-player
  `android/src/main/AndroidManifest.xml:14`); WAKE_LOCK + FOREGROUND_SERVICE
  permissions merge from the library (app manifest comment, line 6).
- **No wake lock is actually used during playback**: kotlin-audio
  `PlayerConfig.kt:35` defaults `wakeMode = WakeMode.NONE`, and *nothing* in `src/`
  or RNTP's `MusicModule`/`MusicService` ever sets it (grep: zero hits). ExoPlayer
  therefore streams with no CPU/WiFi lock; the foreground service protects the
  *process*, not the radio. See diagnosis §1.
- No battery-optimization exemption prompt exists anywhere in the app.

## Audio focus

- `BaseAudioPlayer` requests focus on READY, abandons on ERROR
  (`BaseAudioPlayer.kt:114-118`); request/abandon logic at `:560-598` is correct.
- `onAudioFocusChange` (`:601-624`) computes `{isPaused, isPermanent}` and only
  **forwards** it. `MusicService.kt:655-663` turns that into a JS event
  (`remote-duck`) — **no native pause/resume happens**.
- **`src/playback/` has no `RemoteDuck` handler at all** (grep: zero hits). Focus
  changes are dropped on the floor. See diagnosis §1c.

## State persistence & restore

- Store: **MMKV** (`src/storage/mmkv`), all sync.
- Position: `{trackId, progress: fraction}` written on a **5s debounce** from RNTP
  progress events (`PlayerContext.jsx:179-215`). Queue snapshot persisted on every
  mutation via `applyQueue`; tracks are persisted **without streamUrl** (URLs are
  short-lived upstream CDN links).
- Cold restore (`PlayerContext.jsx:848-955`): `setupPlayer` rides the op chain
  (background-refusal → retry on next foreground, `:877-888`); restore refetches
  streamUrls for idx/idx+1 **over the network** (`:919-926`), then
  `engine.syncQueue(restored, { startIndex, positionSec })` paused (`:943-950`).
  `storedPositionSec` accepts only `0.01 < progress < 0.98` (`:81-95`).
- Race guards: `bootedRef` (`:227`) silences persistence until restore ran;
  `userActedRef` (`:262`, checked at `:915/:927/:944`) lets a user action win over a
  slow restore — **by discarding the restore entirely** (see diagnosis §2).

## Queue model

- JS-owned (`PlayerContext` state + `queueRef`), mirrored into RNTP by
  `engine.syncQueue` (`engine.js:160-211`), which has three tiers:
  same-list → `skip` only; **same-current → remove/re-add around the active index
  without touching the playing track** (no restart); else full replace that
  preserves `playWhenReady`. Reorder/removeAt already exported
  (`PlayerContext.jsx:598`, `:1130-1133`). This is the ready-made foundation for
  reorderable Up Next (feature 4a).
- Gapless-boundary races are handled by re-reading `engine.getActiveIndex()` inside
  ops (`PlayerContext.jsx:628-637` clear-queue guard is the pattern).

## Equalizer / audio effects

- App-owned native module `AuraEqualizerModule.kt` attaches
  `Equalizer`/`BassBoost`/`LoudnessEnhancer` to the ExoPlayer **audio session id**,
  obtained via our patch (`patches/react-native-track-player+4.1.2.patch` adds
  `MusicModule.getAudioSessionId()`; vendored `BaseAudioPlayer` exposes
  `exoPlayer.audioSessionId`). Never attaches to session 0.
- JS owner `src/lib/equalizer.js`: settings in memory + MMKV (**not** re-read per
  track); lazy attach on first need (`:171-210`, `:299-307`); re-apply on route
  change; **re-attach only on AppState `active`** (`:251-255`). The session id is
  per ExoPlayer *instance* — stable across tracks, new on service rebuild. See
  diagnosis §4/§5.

## I/O on the JS thread at open

App boot effects (`App.jsx`): profile refresh (one per launch), push init (per
user-id), `initEqualizer()` (`App.jsx:158` — native describe + MMKV read), home
cache. MMKV reads are sync-but-microseconds; the heavy cost at open is the
**restore's network refetch** (`PlayerContext.jsx:919-926`) — no track can play
until a full catalog round-trip returns a fresh streamUrl. No disk I/O of note on
the UI thread; RN work happens on the JS thread.

## Error handling / retry today

- `Event.PlaybackError` → `engine.handlePlaybackError` (`service.js:100-103`,
  `engine.js:549-566`): refetches a fresh stream URL for the failing track
  (expired-URL case IS handled), **single-shot** — no backoff, no error taxonomy,
  no connectivity awareness. Deliberate-reload invalidation guard at
  `engine.js:397`.
- One quiet retry of a failed play op after service rebuild
  (`PlayerContext.jsx:140-150`).
