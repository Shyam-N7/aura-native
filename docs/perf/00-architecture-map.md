# AURA Native — Architecture Map (Phase 0)

*Perf & reliability recon, 2026-07-27. Every claim carries a file:line citation; line
numbers are as of commit `7a7fdd7`.*

> **The line numbers below are stale — resolve them at `7a7fdd7`, not at HEAD.**
> `7a7fdd7` is real (`refine(share): the link survives the gates…`, 2026-07-26)
> and is an ancestor of HEAD, but **163 commits** have landed since, so the 31
> citations in this file and the 17 in `01` now point at unrelated code. That is
> worse than a broken pin, because they still resolve: `00:105` cites
> `service.js:100-103` for the PlaybackError listener, which at HEAD is a
> remote-like handler — the listener moved to `:197-203`. Read a citation with
> `git show 7a7fdd7:<path>`, and if the clone is shallow (it is, by default)
> `git fetch --depth=200 origin main` first.
>
> Previously recorded here and in `reports/11:164` as "`7a7fdd7` does not exist
> in this repository". That was a **shallow-clone artifact** — `.git/shallow`
> makes the squashed-looking `70e10b3` a graft boundary rather than a root, so
> `git cat-file` reports the commit missing when it is merely not fetched.

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
- ~~**No wake lock is actually used during playback**~~ — true when this map was
  written, **fixed in 1451ded**. kotlin-audio `PlayerConfig.kt` now defaults
  `wakeMode = WakeMode.NETWORK`, and since `MusicService` builds `PlayerConfig`
  without a `wakeMode` argument that default IS the live value. ExoPlayer holds
  the partial wake + wifi locks while `playWhenReady`, and releases them on
  pause/idle and on `exoPlayer.release()`. See diagnosis §1.
- No battery-optimization exemption prompt exists anywhere in the app.

## Audio focus

- `BaseAudioPlayer` requests focus on READY, abandons on ERROR
  (`BaseAudioPlayer.kt:114-118`); request/abandon logic at `:560-598` is correct.
- Focus is handled by **ExoPlayer's built-in focus manager**: `engine.js:138` sets
  `autoHandleInterruptions: true` → `handleAudioFocus = true` (`MusicService.kt:154`)
  → `exoPlayer.setAudioAttributes(attrs, true)` (`BaseAudioPlayer.kt:274`). Pause on
  permanent loss, pause+resume on transient, duck on can-duck — all native. The
  `remote-duck` JS event (`MusicService.kt:655-663`) is informational in this config,
  which is why `src/playback/` legitimately has no handler for it. UI stays in sync
  via `PlaybackPlayWhenReadyChanged`. (Corrected during implementation — see
  diagnosis §1c.)

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
