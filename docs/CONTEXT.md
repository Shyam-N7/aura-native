# AURA — system context

Description only. No quality judgments; those are in `reports/02-review.md`.

Taken at:

| Repo | Short name used below | Path | Branch | HEAD |
|---|---|---|---|---|
| Native app | `native` | `D:\Brave Downloads\AURA Native` | `main` | `027ee93` |
| Web + server | `web` | `D:\Brave Downloads\AI Music Development` | `dev` | `32d185d` |

Both verified clean at these commits; `web`'s `main`, `dev`, `origin/main`, `origin/dev` are all the same commit. A third checkout at `D:\Brave Downloads\AI Music` sits on `main` at the same `32d185d` and is not used.

**Citation correction carried into this pass:** `listLiked` is at `web/server/likes.js:18-32`, not `web/server/library.js:18-28`. The latter is the library-summary aggregate (`web/server/library.js:15-35`). The unbounded-query finding is unchanged; the address was wrong.

---

## 1. Shape of the system

Two deployables and one contract between them.

- `web` is both the web client and the **only** backend. Express 4 runs as a single Vercel serverless function; `web/vercel.json:34` rewrites every `/api/*` path to `api/index.js`, which exports the whole Express app (`web/api/index.js:6-13`).
- `native` is an Android React Native app that talks to that same Express app over HTTPS. It ships no server of its own and **no local database** — MMKV only.
- Catalog content is not owned by either repo. `web/server/catalog.js` proxies JioSaavn; tracks are cached into Postgres opportunistically (`web/server/tracks.js`).

The consequence that shapes everything else: **`native` holds no durable store it can query.** MMKV is a key-value blob cache with hand-rolled shapes. Any list the app shows either came from the server this session or was serialized whole into a single MMKV string.

---

## 2. `native` — module map

~24,800 LOC of JS/JSX plus 4 app-owned Kotlin files and 29 vendored Kotlin files.

| Path | LOC | What it is |
|---|---|---|
| `src/playback/` | 2,937 | The player. `PlayerContext.jsx` (1,356) owns queue state and persistence; `engine.js` (814) is the only module that writes to RNTP; `service.js` (134) is the RNTP playback-service handler table; `queueModel.js` (241) is pure queue math; `autoRadio.js` (240) prefetches the up-next batch; `recorder.js` (152) emits listening events. |
| `src/screens/` | 9,678 | 20 route screens. Largest: `YouScreen.jsx` (1,568), `PlaylistScreen.jsx` (929), `AuthScreen.jsx` (866). |
| `src/overlays/` | 6,543 | 13 sheets rendered above the tab shell. `LyricsOverlay.jsx` (1,765), `QueueSheet.jsx` (1,727), `PlayerSheet.jsx` (1,423). |
| `src/components/` | 6,361 | 10 subdirectories: `audio`, `bridges`, `detail`, `form`, `home`, `library`, `nav`, `player`, `search`, `ui`. |
| `src/lib/` | 2,956 | 38 single-concern modules — settings owners, MMKV-backed prefs, telemetry, toasts. |
| `src/api/` | 1,180 | 24 thin HTTP clients, one per server area. The seam, from this side. |
| `src/hooks/` | 532 | 8 hooks. `usePlaybackProgress.js` is the only read path to RNTP outside `engine.js`. |
| `src/theme/`, `src/utils/`, `src/data/`, `src/navigation/`, `src/storage/` | 537 | Tokens, helpers, static data, the navigator, the MMKV wrapper. |
| `android/app/src/main/java/com/auranative/` | — | `AuraEqualizerModule.kt`, `AuraEqualizerPackage.kt`, `MainActivity.kt`, `MainApplication.kt`. |
| `android/kotlin-audio/` | 29 files | Vendored fork of doublesymmetry/kotlin-audio (§5). |
| `patches/` | 1 | `react-native-track-player+4.1.2.patch`. |

**Data flow, UI → speaker:** a screen calls `usePlayer()` → `PlayerContext` mutates its in-memory queue model and pushes the change onto a serialized op chain → `engine.js` translates to RNTP calls → RNTP `MusicService` (Kotlin, foreground) → vendored `kotlin-audio` `BaseAudioPlayer` → Media3/ExoPlayer. Events come back the other way through `service.js` into handlers `PlayerContext` registered once at boot (`native/src/playback/PlayerContext.jsx:990-999`).

---

## 3. `web` — module map

~10,174 LOC of server JS across 43 non-test modules, plus 28 server test files and a Vite React client in `src/`.

| Path | LOC | What it is |
|---|---|---|
| `server/app.js` | 1,498 | The Express app: middleware, rate limits, and 74 inline route handlers. |
| `server/db.js` | 750 | `pg` Pool, transient-retry wrapper, and the full migration ladder. |
| `server/auth.js` | 700 | Its own `express.Router` — 20 more routes mounted at `/api/auth` (`web/server/app.js:149`). |
| `server/playlists.js` | 519 | Playlist CRUD, collaborators, saves, public links. |
| `server/stems.js` | 518 | MVSEP stem separation, Vercel Blob storage. |
| `server/catalog.js` | 394 | JioSaavn proxy: search, featured, track, playlist. |
| `server/autoPlaylists.js`, `homeReco.js`, `quickPicks.js`, `discoveryMix.js`, `related.js`, `tasteScore.js`, `modes.js` | ~1,300 | Recommendation surfaces. |
| `server/push.js`, `notify.js` | 312 | FCM send + triggered-notification guardrails. |
| `server/middleware/errors.js` | — | `clientError`, `notFound`, `errorMiddleware`. |
| `server/processGuards.js` | 25 | Process-level `unhandledRejection` / `uncaughtException` backstop. |
| `api/index.js`, `api/loudness-measure.js` | 65 | The two Vercel function entries. |
| `src/` | — | Web client: `api`, `audio`, `components`, `data`, `hooks`, `lib`, `screens`, `styles`, `test`, `tweaks`, `utils`. |

Routers beyond `app.js`: `/api/auth` (`server/auth.js`), `/api/family` (`server/family.js`), `/api/modes` (`server/modes.js`), mounted at `web/server/app.js:149-155`.

---

## 4. The seam — API contract

`native` reaches the server through exactly one function: `fetchAuthed(path, opts)` at `native/src/lib/auth.js:492-502`. It prefixes `API_BASE`, attaches `Authorization: Bearer <aura.authToken>`, and on a 401 kicks a de-duped `fetchMe()` re-validation (`native/src/lib/auth.js:469-482`) rather than signing out directly. Auth endpoints in `native/src/lib/auth.js` call `fetch` directly instead, since they have no token yet.

`fetchAuthed` sets **no timeout, no retry, and no abort default**. Callers pass `signal` when they have one; each caller checks `res.ok` and throws its own `Error`.

Server surface: **94 routes** — 74 in `app.js`, 20 in the auth router.

### Endpoints `native` calls, by boundedness

**Unbounded — one request returns the entire row set, no LIMIT, no pagination:**

| Endpoint | Server | Grows with |
|---|---|---|
| `GET /api/likes` | `web/server/likes.js:18-32` | liked tracks, forever |
| `GET /api/likes?ids=1` | `web/server/likes.js:35-41` | same, ids only |
| `GET /api/playlists/:id` | `web/server/playlists.js:162-170` | tracks in that playlist |
| `GET /api/playlists` | `web/server/playlists.js:75-93` | playlists owned or collaborated |
| `GET /api/playlists/saved` | `web/server/playlists.js:475-491` | saved playlists |
| `GET /api/hidden` | `web/server/hiddenTracks.js:34-47` | hidden tracks, forever |
| `GET /api/journal?days=N` | `web/server/journal.js:41-51` | listening events in the window |

**Bounded:**

| Endpoint | Cap | Where |
|---|---|---|
| `GET /api/history` | 80 default, 200 max | `web/server/app.js:945` |
| `GET /api/events/recent` | 50 default, 500 max | `web/server/app.js:1382` |
| `GET /api/catalog/search` | `n` ≤ 40, results sliced to `limit` | `web/server/catalog.js:269,286` |
| multi-entity search | 12 albums, 12 playlists | `web/server/catalog.js:371-372` |
| `GET /api/tracks/:id/related` | 8 default, 20 max | `web/server/related.js:171` |
| `GET /api/loudness?ids=` | `MAX_BATCH` | `web/server/loudness.js:52` |
| `GET /api/stats/*` | `LIMIT $3` | `web/server/stats.js:33,67,131` |
| `GET /api/history/clock?days=` | 60 default, 365 max | `web/server/app.js:957` |

**Other endpoints called by `native`** (bounded by nature — single row, single object, or a write): the 11 `/api/auth/*` calls, `/api/catalog/track/:id`, `/api/catalog/featured`, `/api/albums/:id`, `/api/artists/lookup`, `/api/discover/home`, `/api/discover/playlist/:id`, `/api/home/{hero,quick-picks,stations,new-for-you}`, `/api/library/summary`, `/api/playlists/auto`, `/api/playlists/invite/:token/accept`, playlist mutations (`tracks`, `cover`, `visibility`, `only-me`, `save`, `collaborators`), `/api/playback/{now,heartbeat,resume}`, `/api/push/{register,prefs,card-art}`, `/api/lyrics/:track_id`, `/api/loudness/measure`, `/api/why`, `/api/llm/talk`, `/api/greeting`, `/api/mood/current`, `/api/sonic-dna`, `/api/bridges/{suggest,:from/:to}`, `/api/impressions`, `/api/events`, `/api/stems/request`, `/api/uploads/image`, `/api/modes/active`, `/api/family/{enable,disable}`, `/api/admin/push/{reach,send}`.

**Rate limiting** is applied by prefix at `web/server/app.js:136-146`: a general limiter on all `/api`, a tighter one on `/api/auth`, a cost limiter on `/api/{why,lyrics,greeting,mood,llm}`, a sensitive limiter on `/api/{family,modes}`, and a stems limiter.

---

## 5. The playback stack

**Layers:** `native/src/playback/engine.js` → `react-native-track-player` 4.1.2 (patched) → `android/kotlin-audio` (vendored) → Media3/ExoPlayer.

**What is vendored and why.** `android/kotlin-audio/` is a source fork of doublesymmetry/kotlin-audio, 29 Kotlin files, built as a local Gradle module rather than pulled from Maven. Divergence from upstream is marked in-source with an `AURA` comment at every site — 11 sites across 6 files:

| File | Divergence |
|---|---|
| `models/PlayerConfig.kt:35` | `wakeMode` default flipped `NONE` → `NETWORK`. `MusicService` constructs `PlayerConfig` without a wake mode, so the default is the only lever. This is what keeps ExoPlayer's partial wake lock + wifi lock alive while `playWhenReady`. |
| `players/components/PlayerCache.kt:18` | `LeastRecentlyUsedCacheEvictor` takes **bytes**; `CacheConfig` and RNTP's public `PlayerOptions.maxCacheSize` both document **kilobytes**. The fork multiplies by 1024 to make the documented unit true. |
| `players/BaseAudioPlayer.kt:96` | Adds a public `audioSessionId` accessor — `exoPlayer` is protected upstream, and the equalizer needs the session. |
| `players/BaseAudioPlayer.kt:286` | Next/previous media-button presses delegated to the app rather than handled internally. |
| `notification/NotificationManager.kt` (5 sites: 89, 463, 494, 673, 771) | The reason the library is vendored at all, plus the app-defined custom action (the notification heart) carried as both a media-session action and a classic notification button. |
| `models/MediaSessionCallback.kt:8`, `models/NotificationConfig.kt:35` | Model support for that custom action. |

RNTP itself carries one patch, `patches/react-native-track-player+4.1.2.patch`, applied by `patch-package` on `postinstall`.

**Player options** are built once in `native/src/playback/engine.js:76-101` and re-sent whole on any change (`updateOptions` replaces the full set, so a heart flip re-sends everything). Setup at `native/src/playback/engine.js:100-175`: `autoHandleInterruptions: true`, `maxCacheSize: 262144` (KB → 256 MB on disk given the fork's unit fix), `playBuffer: 2.5`, `minBuffer: 30`, `maxBuffer: 120`, `progressUpdateEventInterval: 1`.

**App-killed behaviour** is user-controlled: `appKilledPlaybackBehavior` is `ContinuePlayback` unless the `aura.backgroundPlay` pref is `'0'`, in which case `StopPlaybackAndRemoveNotification` (`native/src/playback/engine.js:76-80`).

**Foreground service.** `native/android/app/src/main/AndroidManifest.xml` declares only `INTERNET`, `POST_NOTIFICATIONS`, `VIBRATE`, `MODIFY_AUDIO_SETTINGS`. `WAKE_LOCK`, `FOREGROUND_SERVICE*`, and the `MusicService` declaration itself arrive by manifest merge from RNTP's own manifest — noted in a comment at lines 5-7.

**Equalizer attachment.** `AuraEqualizerModule.kt` is an app-owned native module. It obtains the ExoPlayer audio session id through the patched RNTP `MusicModule.getAudioSessionId()`, which reads the fork's `BaseAudioPlayer.audioSessionId`. JS owner is `native/src/lib/equalizer.js`. The session id is per-ExoPlayer-instance: stable across track changes within one player, **new on every service rebuild**. Re-attachment is driven from the JS side.

---

## 6. Source of truth for queue and playback state

**The server is authoritative for content; the client is authoritative for the queue.** These are different things and the split matters.

- Track *content* (title, artist, duration, artwork, and above all `streamUrl`) belongs to the server. `streamUrl` is a short-lived CDN link.
- The *queue* — which tracks, in what order, which index is active — is client-owned. There is no server-side queue table. `/api/playback/{now,heartbeat,resume}` records what is playing for presence and cross-device resume; it is not a queue store.

**The in-process chain of custody** (`native/src/playback/PlayerContext.jsx:38-42` states this design intent): the React state `queue` is the model; `queueRef` mirrors it for event handlers subscribed once; the native RNTP queue is a projection pushed by `engine.js`. User actions mutate the model first and then push. Native-initiated changes (auto-advance, error auto-skip) flow back through `onActiveTrackChanged`.

**Serialization.** All engine calls ride one promise chain, `opChain` (`native/src/playback/PlayerContext.jsx:150-156`), so rapid mutations cannot interleave. Play-intent operations use `enqueuePlayOp` (`:163`), which retries once after rebuilding the native queue from the model — the post-kill state is exactly "model full, native empty".

**Where a local copy can drift from the server:**

1. **`streamUrl` is deliberately stripped on persist** (`native/src/playback/PlayerContext.jsx:1222-1225`, via `model.serializeQueue`). A restored queue therefore always has stale-or-absent URLs and must re-resolve before audio. This is intentional, not drift, but it is the reason cold open can touch the network.
2. **Track metadata cache, 15-minute TTL** (`native/src/api/catalog.js:63-65`, cap 150 entries, LRU, one MMKV blob). Inside the TTL the app plays from cached metadata and never asks the server. A title or artwork edited server-side is invisible for up to 15 minutes.
3. **Auto-radio batch cache** `aura.autoNext.v1` (`native/src/playback/autoRadio.js:10`) — persisted picks that may no longer match server-side taste state.
4. **Likes** are mirrored client-side for instant heart response; `invalidateHomeCache('quickPicks')` (`native/src/api/likes.js`) is a local invalidation only.
5. **Home cache** (`native/src/lib/homeCache.js`) and per-screen snapshots (`native/src/lib/snapshot.js`, key `aura.snapshot.<name>`) render last-known content before any request returns.
6. **The queue itself never reconciles against the server**, because there is nothing to reconcile against. Two devices playing the same account have independent queues.

---

## 7. MMKV inventory

Wrapper: `native/src/storage/mmkv.js` — 18 lines, a synchronous `localStorage`-shaped shim over one unnamed `MMKV()` instance so web-ported modules keep their call sites. **Everything is a string**; every structured value is `JSON.stringify`d by its owner.

34 static keys plus two key *families*.

| Key | Written by | Read by | Missing / stale on cold start |
|---|---|---|---|
| `aura.authToken` | `lib/auth.js:12` | every `fetchAuthed` | absent → signed out, auth gate shows |
| `aura.authUser` | `lib/auth.js:13` | app shell | absent → signed out |
| `aura.queue` | `PlayerContext.jsx:44`, 400 ms debounce + unmount flush (`:1211-1240`) | `loadStoredQueue()` `:54-84` | absent → empty queue. Version-stamped **inside** the payload (`v: 1`, `:52`); unknown version → dropped; **no** `v` → treated as pre-versioning and restored. Id-less entries filtered, index slid to compensate (`:71-79`) |
| `aura.position` | `PlayerContext.jsx:45`, 5 s throttle (`:277-280`) | `readStoredPosition` `:91`, `usePlaybackProgress.js:13` | absent → start of track. Guarded to `0.01 < progress < 0.98` and matching `trackId` |
| `aura.repeat` | `PlayerContext.jsx:46` | `readStoredRepeat` `:86` | non-`all`/`one` → `'off'` |
| `aura.trackCache.v1` | `api/catalog.js:63` | `getTrack` | absent → every play pays a round-trip. LRU cap 150, TTL 15 min |
| `aura.autoNext.v1` | `playback/autoRadio.js:10` | same | absent → "finding next song" on first extend |
| `aura.backgroundPlay` | `playback/engine.js:73` | read at module load (`:74`) | absent → **on** (`!== '0'`) |
| `aura.backgroundPlayNoConfirm` | `lib/confirm.js` area | same | absent → confirm shown |
| `aura.audioQuality` | `lib/audioQuality.js:8` | same | absent → default tier |
| `aura.equalizer` | `lib/equalizer.js:36` | same | absent → flat |
| `aura.eq.userPresets` | `lib/eqPresets.js:13` | same | absent → built-ins only |
| `aura.eqWarnOff`, `aura.leveling` | `lib/leveling.js:11` | same | absent → defaults |
| `aura.lastCrash` | `lib/crashLog.js:10` | next launch | absent → no prior crash |
| `aura.hasOnboarded`, `aura.seedArtists`, `aura.seedLanguages`, `aura.seedMood` | `lib/onboarding.js:10-12` | onboarding gate | absent → onboarding runs |
| `aura.hintsDone`, `aura.gestureTourDone`, `aura.tapHint.*` (family, `lib/tapHint.js:8`) | hint modules | same | absent → hints show again |
| `aura.snapshot.<name>` (family, `lib/snapshot.js:11`) | per-screen | same | absent → screen renders empty then fills |
| `aura.theme`, `aura.ribbonStyle`, `aura.playerGesturesOff`, `aura.queueHidePast`, `aura.sortLiked`, `aura.sortPlaylist`, `aura.recentSearches`, `aura.talkHistory`, `aura.moodBridge`, `aura.privateUntil`, `aura.sensingShown`, `aura.whatsNewSeen`, `aura.pushAsked.v2` | their `lib/` owners | same | absent → documented default per module |

Only two keys carry an explicit version: `aura.queue` (in-payload) and `aura.trackCache.v1` / `aura.autoNext.v1` (in-key). The rest would be read as-is by a future shape change.

---

## 8. Server data layer

**Postgres (Neon, Singapore).** `web/server/db.js:31`:

```js
new Pool({ connectionString: TARGET_URL, max: 2, idleTimeoutMillis: 10000, keepAlive: true })
```

`max: 2` is deliberate — each warm serverless instance holds at most two sockets so a fan-out of instances cannot exhaust Postgres. The comment at `:25-30` says production `DATABASE_URL` should point at Neon's `-pooler` host for server-side multiplexing on top. **Whether the deployed env var actually uses the pooler endpoint is unverified** — it is a Vercel environment variable and I did not read it.

Two layers of connection-drop resilience:
- `pool.on('error')` at `:39-41` — mandatory for `pg`; an idle client whose socket Neon reaped emits on the pool, and with no listener Node rethrows it as uncaught.
- `query()` at `:68-77` — a `pool.query` drop-in that retries **only** transient connection errors (`isTransient`, `:56-64`) twice with 100/200 ms backoff. Never retries SQL or constraint errors. Multi-statement transactions must retry at the transaction boundary instead.

Migrations live in the same file as an ordered array (`:79+`) and run via `npm run migrate`, not per request (`web/api/index.js:4-5`).

**Upstash Redis caches nothing.** Its only use in the repo is `web/server/rateLimitStore.js` — a shared store for `express-rate-limit`, an INCR+PEXPIRE Lua script keyed per limiter (`:30-32`). If `UPSTASH_*` env vars are absent it falls back to in-memory (`:22`). There is **no query cache, no invalidation rules, and no cached responses in Redis**.

**Vercel Blob** is used in exactly two places: `web/server/stems.js` (separated stem audio) and `web/server/uploads.js` (user image uploads — avatars, playlist covers).

**Region.** `web/vercel.json:8` pins `bom1` (Mumbai). Neon is Singapore. Every query is a cross-region hop.

**Error handling.** `errorMiddleware` is the single terminus for thrown/forwarded route errors (`web/server/app.js:1491-1496`), with `notFound` before it. Underneath, `installProcessGuards()` runs at every entry (`web/api/index.js:11`, `web/api/loudness-measure.js:15`, `web/server/index.js:9`) and converts `unhandledRejection` / `uncaughtException` into logged, non-fatal events — necessary because Express 4 does not forward async-handler rejections and Node 20 defaults to `--unhandled-rejections=throw`.

---

## 9. Threading and concurrency on the client

**New Architecture is on** — `native/android/gradle.properties:49` `newArchEnabled=true`, `:53` `hermesEnabled=true`. So Fabric renders and TurboModules bridge; there is no legacy async bridge queue.

**JS thread** owns: all React state including the queue model, the `opChain` promise chain, every `src/api` fetch, MMKV reads and writes (synchronous — they block the JS thread, briefly), RNTP event handlers from `service.js`, and `usePlaybackProgress`'s 4 Hz tick.

**UI thread** owns the Reanimated worklets. 38 `'worklet'` directives across 9 files: `QueueSheet.jsx`, `PlayerSheet.jsx`, `components/ui/Sheet.jsx`, `components/ui/Bounce.jsx`, `components/ui/EqFader.jsx`, `components/nav/Dock.jsx`, `components/player/ProgressRibbon.jsx`, `components/home/QuickPicksWheel.jsx`, `components/search/SearchField.jsx`.

**The drag-reorder path** (`native/src/overlays/QueueSheet.jsx`) is the most concurrency-sensitive code in the app. `Gesture.Pan()` at `:299` runs `onStart` (`:306`), `onUpdate` (`:352`, `:385`), and `onEnd` (`:409`) entirely as worklets on the UI thread, driving shared values `dragFrom`, `dragTo`, `dragShift`, `scrollY`, `fingerY`, `listTop` (`:1175-1196`). It crosses back to JS through `runOnJS` at exactly four points: pickup haptics (`:346`), the drag flag (`:349`, `:430`), and the commit (`:403`). Auto-scroll during drag uses Reanimated's `scrollTo` from the worklet (`:25`, `:322`). 40 `runOnJS` call sites exist across `src/` in total.

`FlatList` `windowSize` is raised while dragging and returns to the shared bound at rest (`native/src/overlays/QueueSheet.jsx:1523`).

**Native threads:** RNTP's `MusicService` runs the ExoPlayer on its own looper; `AuraEqualizerModule` attaches `android.media.audiofx` effects to that session id from the module's method-call thread.

---

## 10. Build, run, test

### `native`

All Android commands funnel through `scripts/env.cmd`, which pins the whole toolchain to `D:\` (`JAVA_HOME=D:\Android\jdk-17`, `ANDROID_HOME=D:\Android\sdk`, plus `GRADLE_USER_HOME`, `NPM_CONFIG_CACHE`, `TMP`/`TEMP`) because the machine-level `ANDROID_HOME` points at a nonexistent `C:` path.

| Command | Status |
|---|---|
| `npm test` (jest) | **Works.** 46 suites / 271 tests pass, 43.9 s. Verified this pass. |
| `npm run lint` (eslint) | Not re-run this phase. |
| `npm run android:release` | **Does not work when invoked from PowerShell.** The script is `call scripts\env.cmd && cd android && call gradlew assembleRelease`; `call` is a cmd.exe builtin and PowerShell fails it with `'m' is not recognized`. Workaround: set the env vars and run `android\gradlew.bat` directly. |
| Sentry source-map upload during release | Reads an auth token from a file **outside** the repo. A previous release build exited 1 at this step. Unverified whether it still does at this HEAD. |
| `npm run android:install` | `adb install -r android\app\build\outputs\apk\release\app-release.apk`. adb is at `D:\Android\sdk\platform-tools\adb.exe` — **not on PATH** outside `env.cmd`. |

Jest config at `jest.config.js` + `jest.setup.js`. 46 suites covering queue model, playback engine paths, retry policy, track cache, deep-link guard, playlist screens, lyric sync, audio quality, leveling, music clock, and more. No coverage threshold is configured; coverage was not measured this phase.

### `web`

| Command | Status |
|---|---|
| `npm test` (`vitest run`) | **Works.** 70 files / 499 tests pass, 48.7 s. Verified this pass. |
| `npm run dev` / `npm run server` / `npm run dev:all` | Vite + `node --watch --env-file=.env.local server/index.js`, run together via `run-p`. |
| `npm run migrate` | `node server/migrate.js`. Must be run separately from deploy. |
| `npm run build` | `vite build` → `dist`. |
| `npm run lint` | `eslint src` — **note it lints `src` only, not `server/`**. |

Both repos run `patch-package` on `postinstall`.

---

## 11. Conventions worth preserving

- **One writer per concern.** `engine.js` is the only module that calls RNTP mutating APIs; `usePlaybackProgress.js:35-37` documents itself as the single deliberate read-only exception.
- **Comments explain the *why*, and specifically the failure that motivated the code.** Many carry a field report or a doc reference (`docs/perf/02 layer 2`). They are load-bearing documentation; several findings in this audit were confirmed from them.
- **Divergence from vendored upstream is marked in-source** with an `AURA` prefix at every site.
- **Persisted shapes get a version** — in the payload where the key must not change (`aura.queue`), in the key where it may.
- **Server list functions return mapped objects, never raw rows** (`rowToTrack`, `mapTrackRow`).
- **Rate limits are applied by path prefix in one block**, `web/server/app.js:136-146`.
- **Guardrails live at the send site, not the call site** — every triggered push goes through `sendCategory` (`web/server/push.js:116`), so no individual trigger can spam.
- UI copy is plain and lowercase.

---

## 12. Landmines

1. **`android/kotlin-audio/` is a source fork with no upstream tracking.** 11 marked divergences. Re-pulling upstream or bumping RNTP silently reverts the wake mode, the cache-unit fix, the session-id accessor, and the notification heart.
2. **`PlayerCache.kt:18`'s unit conversion is invisible from JS.** `maxCacheSize: 262144` in `engine.js` means 256 MB *only because of the fork*. On stock kotlin-audio the same number is 256 KB.
3. **`updateOptions` replaces the entire option set.** Any partial call drops the like button, capabilities, and app-killed behaviour.
4. **`aura.queue` is the user's queue.** The version check drops unknown payloads wholesale (`PlayerContext.jsx:64-66`). Changing the serialized shape without bumping `QUEUE_VERSION` corrupts; bumping it discards.
5. **`storedPositionSec`'s window is `0.01 < progress < 0.98`** and is duplicated in two places — `PlayerContext.jsx:103-117` and `hooks/usePlaybackProgress.js:16-23`. They must agree or the display seed disagrees with the audio seek.
6. **`db.js` migrations are an append-only ordered array.** Editing an existing entry does not re-run it.
7. **`max: 2` in the pool is load-bearing**, not a tuning knob.
8. **`web/npm run lint` does not cover `server/`.**
9. **JS `console.*` output does not reach logcat in release builds.** Sentry breadcrumbs are the only channel that escapes.
10. **`adb` cannot drive a gesture-handler pan.** `input swipe`, `draganddrop`, and `motionevent` all land as taps. Drag behaviour requires a real finger.
11. **Secrets live outside both repos** — Firebase admin JSON and the Sentry auth token. Never printed, never committed.

---

## 13. Unverified in this phase

- Whether production `DATABASE_URL` points at Neon's `-pooler` endpoint (Vercel env var, not in repo).
- Actual production data scale — distribution of liked-track and playlist-track counts. Requires a read-only query against prod.
- Whether the Sentry source-map upload still fails the release build at this HEAD.
- Test coverage percentage for either repo — no coverage run was performed.
- `web/src/` (the web client) was mapped at directory level only; its internals were not read this phase.
