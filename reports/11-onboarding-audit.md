# 11 — Onboarding audit

Whole-repo read at HEAD `0da8e85`, taken as an onboarding pass: what the app is,
how it is put together, and what is wrong with it. Description and findings
only — the fixes that followed are tracked in the status section at the end.

Method, for weighting the claims: all 335 tracked files were read across ten
partitions plus a coverage sweep, so nothing but binaries went unopened. Three
risk hunters produced 38 findings, each then handed to an independent agent
instructed to *refute* it — 32 survived, 6 came back corrected, 0 were thrown
out. A second verification round put twelve single-sourced high-severity claims
through the same treatment: 6 held, 6 were corrected, and three dropped out of
the top tier entirely. Findings below carry that provenance inline: **[V]**
verified, **[V-adj]** verified with the claim corrected, **[1×]** single-source
and unchecked.

Companion to `reports/01`–`10`. Where this contradicts `docs/CONTEXT.md`, that
document is older — its specifics have drifted (see section E, doc rot).

---

## A. What this product is

AURA is a personal music-streaming app for Android (`live.aurafm.app`, versionName 0.1.0), built on React Native 0.83 / React 19 with Hermes and the New Architecture (`android/gradle.properties:49,53`). It is the native half of a two-repo system: all content comes from a companion web repo **not in this checkout** that serves `https://www.aurafm.live` — an Express API on Vercel over Neon Postgres, with the music catalog proxied from JioSaavn (`docs/CONTEXT.md:22-24`). The app streams that catalog with fixed + adaptive audio quality, a client-owned queue with drag-reorder and "auto-radio" endless continuation, synced lyrics/karaoke with instrumental stems, likes, collaborative playlists, listening insights (journal, "sonic DNA", music clock), mood "bridges", an LLM DJ chat ("Talk"), a native equalizer with volume leveling, FCM push (plus an in-app admin push composer), and cross-device presence/resume. There is no local database — durable client state is ~36 plaintext MMKV string keys — and no env layer: API origin and Sentry DSN are hardcoded (`src/lib/auth.js:10`, `index.js:27`). The chrome is built on a native "glass" capture-blur stack (patched BlurView pipeline in Kotlin) plus Skia "goo" effects. It is a solo-developer codebase ported from the web app (`UPSTREAM.md`), with an unusual amount of in-repo audit documentation (`docs/`, `reports/`) that is itself part of the working method.

## B. Feature inventory

| Feature | Entry point | Key files | External services / endpoints |
|---|---|---|---|
| Playback core (tap → speaker) | `src/playback/PlayerContext.jsx:635` | `engine.js`, `queueModel.js`, `service.js` | RNTP (patched) → vendored kotlin-audio → ExoPlayer2 2.19; CDN `_<bitrate>.mp4` URLs |
| Queue editing + drag-reorder | `src/playback/PlayerContext.jsx:232` | `src/overlays/QueueSheet.jsx`, `queueModel.js` | none |
| Auto-radio continuation | `src/playback/autoRadio.js:153` | `PlayerContext.jsx:410-554` | `GET /api/tracks/:id/related`; MMKV `aura.autoNext.v1` |
| Queue/position persistence + cold restore | `PlayerContext.jsx:1014` | `queueModel.js:227`, `src/hooks/usePlaybackProgress.js` | MMKV `aura.queue`/`aura.position`/`aura.repeat` |
| Playback error recovery + quality ladder | `src/playback/engine.js:687` | `retryPolicy.js`, `audioQuality.js`, `autoQuality.js` | `HEAD {API_BASE}/manifest.webmanifest` probe (`engine.js:658`) |
| Media notification + heart button | `src/playback/service.js:28` | `engine.js:76-132`, RNTP patch, `res/drawable/ic_heart*.xml` | Android MediaSession |
| Listening recorder (play/pause/skip/end) | `src/playback/recorder.js:28` | `src/api/events.js` | `POST /api/events` |
| Cross-device presence + resume | `src/overlays/PresenceAgent.jsx` | `usePlaybackPresence.js`, `api/playback.js`, `presenceFeed.js` | `/api/playback/{heartbeat,now,resume}` |
| Sleep timer (duration + end-of-set) | `src/lib/sleepTimer.js:50` | `SleepTimerSheet.jsx`, `PlayerContext.jsx:293,564` | none (not persisted) |
| Lyrics / karaoke / music-only stems | `src/overlays/LyricsOverlay.jsx` | `lyricsSync.js`, `api/lyrics.js`, `api/stems.js` | `/api/lyrics/:id`, `/api/stems/request` (polled) |
| Volume leveling | `src/lib/leveling.js` | `PlayerContext.jsx:895-897` | `/api/loudness`, `/api/loudness/measure` |
| Equalizer (bands/bass/volume boost, per-route profiles, presets) | `src/lib/equalizer.js` (init `App.jsx:214`) | `AuraEqualizerModule.kt`, `EqualizerPanel.jsx`, `eqPresets.js` | `android.media.audiofx`; RNTP `getAudioSessionId()` (patch) |
| Auth (signup/login/OTP/reset/device-limit) | `src/screens/AuthScreen.jsx` | `src/lib/auth.js`, `src/storage/mmkv.js` | 11 `/api/auth/*` endpoints |
| Session / bearer / 401 revalidation | `src/lib/auth.js:507` | `App.jsx:55-106` flow gate | `GET /api/auth/me` |
| Home surface (rails, hero, stations, quick-picks wheel) | `src/screens/HomeScreen.jsx` | `homeCache.js`, `snapshot.js`, `useFeaturedPool.js`, `components/home/*` | ~10 endpoints: featured, quick-picks, hero, new-for-you, stations, stats×3, playlists, discover, auto-playlists |
| Search (debounced, language pills, recents) | `src/screens/SearchScreen.jsx` | `searchQuery.js`, `TopBar.jsx`, `useRecentSearches.js` | `GET /api/catalog/search` |
| Likes (optimistic, heart UI) | `src/hooks/useLikes.js` | `HeartButton.jsx`, `TapHeart.jsx`, `api/likes.js` | `/api/likes*` |
| Playlists (CRUD, collab invites, public links, covers, save) | `src/screens/PlaylistScreen.jsx`, `PlaylistsScreen.jsx` | `api/playlists.js`, `AddToPlaylistSheet.jsx`, `api/uploads.js` | `/api/playlists/*`, `/api/uploads/image` |
| Detail screens (Album/Artist/Liked/History/LanguageHub/CatalogPlaylist) | `src/navigation/RootTabs.jsx:61-125` | `DetailChassis.jsx`, `ListTools.jsx`, `listFilter.js`, `listWindow.js` | per-screen endpoints |
| Insights (journal, DNA, stats, music clock) | `JournalScreen`, `DnaScreen`, `HistoryScreen` | `musicClock.js` | `/api/journal`, `/api/sonic-dna`, `/api/stats/*`, `/api/history*` |
| Mood bridges | `src/screens/BridgesScreen.jsx` | `lib/bridges.js`, `BridgeItinerary.jsx` | `/api/bridges/{suggest,:from/:to}` |
| Talk (LLM DJ) | `src/screens/TalkScreen.jsx` | `useTalkHistory.js`, `api/talk.js` (45s deadline) | `POST /api/llm/talk`, `/api/mood/current` |
| Why this song | `src/overlays/WhySheet.jsx` | `api/why.js` | `/api/why` |
| Onboarding + daily "sensing" gate | `App.jsx:236-241` | `OnboardingScreen.jsx`, `SensingScreen.jsx`, `lib/onboarding.js`, `lib/sensing.js` | `/api/discover/home`, `/api/mood/current`, `/api/stats/top-artists` |
| Push + admin composer | `src/lib/push.js`; `AdminComposeScreen.jsx` | `index.js:41`, `App.jsx:222-233` | FCM (project `aura-6d37b`); `/api/push/*`, `/api/admin/push/*` |
| Deep links + share | `App.jsx:119-193` | `lib/share.js`, `AndroidManifest.xml:72-95` | `https://(www.)aurafm.live` paths `/t/`, `/p/`, `/playlists` |
| Glass chrome blur | `src/components/ui/Glass.jsx` | `GlassBackdrop.js`, `GlassViewManager.kt`, `GlassBlurController.kt`, `navFreeze.js` | Dimezis BlurView 2.0.6 (native, controller replaced) |
| Goo / metaball visuals | `src/components/ui/Goo.jsx` | `Dock.jsx`, `AuraLoader.jsx` | `@shopify/react-native-skia` |
| Theming (3 themes + auto) | `src/theme/ThemeContext.jsx` | `tokens.js`, `motion.js` | MMKV `aura.theme` |
| Crash black box + telemetry | `index.js:19-32` | `crashLog.js`, `crumbs.js`, `perfMarks.js` | Sentry (org aura-fm), sessions on, traces off |
| Offline snapshots | `src/lib/snapshot.js` | `homeCache.js`, Home/You screens | MMKV `aura.snapshot.<name>` (owner-stamped by email) |
| Private session (6h) | `src/lib/privateSession.js` | suppresses `events`/`impressions`/presence | none |
| Hints / gesture tour / what's-new | `lib/hints.js`, `gestureTour.js`, `tapHint.js`, `whatsNew.js` | `GestureTourOverlay.jsx`, `WhatsNewSheet.jsx` | MMKV flags |

## C. Architecture

**System shape.** Two deployables, one contract. This repo is the Android client only; the Express/Postgres backend and web client live in a separate repo (`docs/CONTEXT.md:22-26`). The client holds no durable queryable store — MMKV key-value blobs only.

**Layering (UI → speaker).** Screens/overlays → `PlayerContext.jsx` (queue model + React state, ~1,400 lines) → `engine.js` (sole RNTP *writer* by convention, `engine.js:26`) → patched `react-native-track-player` 4.1.2 → vendored `android/kotlin-audio` fork → ExoPlayer2 2.19. Events return through `service.js`'s handler table into handlers PlayerContext registers once at boot (`PlayerContext.jsx:1025`). The "only engine talks to RNTP" claim is aspirational: `service.js`, `recorder.js`, `queueDrift.js`, and `usePlaybackProgress.js` also import it (reads + listeners).

**Concurrency model.** All queue mutations ride one promise chain (`opChain`, `PlayerContext.jsx:152-166`); play-intents get a retry-once-after-rebuild wrapper (`enqueuePlayOp`, `:173-206`) for the post-kill "model full, native empty" state. `engine.js` adds its own `queueLock` (`:187-196`) because the auto-quality sampler's 5s interval calls `remapQueue` outside the chain. UI-thread work is Reanimated worklets; the hairiest is QueueSheet's drag-reorder (shared values + `useFrameCallback` auto-scroll, `QueueSheet.jsx:299-431,1229-1267`).

**API seam.** 26 thin client modules (`src/api/*` + `auth.js` + `push.js`) → one function `fetchAuthed` (`src/lib/auth.js:507-529`): API_BASE prefix, bearer header, 15s default deadline (`deadlineMs:0` opt-out for `getTrack`), 401 → de-duped `/api/auth/me` revalidation rather than instant sign-out (`auth.js:469-482`). ~70 distinct endpoints. **No retries in the API layer** — `retryPolicy.js` is consumed only by `engine.js` (`engine.js:18-22`).

**State management.** No Redux/Query. Two React contexts (Theme, Player) plus ~15 module-level singletons: 10 sheet buses (`src/lib/*Sheet.js` etc. — same 16-line Set-of-subscribers idiom), likes store (`useLikes.js:12`), search query bus, presence feed, scroll-depth bus, talk history, recent searches. Server-state caching is four-tier: in-memory session cache (`homeCache.js` — no TTL, no owner), disk snapshots (`snapshot.js` — owner-stamped by email), a 15-min/150-entry track LRU (`api/catalog.js:63-152`), and in-memory lyrics/loudness caches.

**Auth flow.** Token + user JSON in plaintext MMKV (`aura.authToken`/`aura.authUser`). Gate is a monotonic ranked flow auth → sensing → onboarding → main (`App.jsx:54-66`); a uid change resets the gate and exactly two module stores (`invalidateHomeCache()` + `resetLikesStore()`, `App.jsx:96-97`) — the other module singletons survive sign-out (risk class E2). `clearSession` wipes 10 MMKV keys (`auth.js:99-113`).

**Error handling.** Norm: caller checks `res.ok` and throws; telemetry-ish endpoints (notifications, playback presence, loudness, impressions, events, homeReco) swallow everything and return defaults. Playback has a real taxonomy-driven retry ladder (`engine.js:600-823`, `docs/perf/03-retry-policy.md`). Crash path: MMKV black box (`crashLog.js`) + Sentry with app-hang tracking, 100% session sampling, 0% tracing (`index.js:26-32`). User-facing failures surface as toasts; screens keep stale data on refetch failure.

**Conventions (and where they break).**
- *Comments explain the motivating failure* — often citing field reports/docs; they are load-bearing and mostly accurate (one now lies: `useTalkHistory.js:7` claims sign-out clearing that doesn't happen).
- *Fork divergence marked `AURA` in-source* — 11/12 sites marked; one unmarked (`QueuedAudioPlayer.kt:210-219` swallows `IllegalSeekPositionException`).
- *Versioned persisted shapes* — honored by 3 of ~36 MMKV keys (`aura.queue` in-payload; `trackCache.v1`/`autoNext.v1` in-key); the rest unversioned.
- *One writer per concern* — true for MMKV key owners; violated for RNTP imports (5 modules).
- *Module-bus idiom* — 10 copies in two dialects; replay-state-on-subscribe implemented in exactly one (`presenceFeed.js:15`).
- *Owner-stamped offline state* — disk snapshots yes, in-memory caches no (the account-switch leak class).
- *Screens lazy-loaded* via `getComponent` (`RootTabs.jsx:26`); 4 tabs + 13 stack screens + 3 gate screens.
- Windows-only build scripts (`call scripts\env.cmd`, cmd.exe-only, `package.json:6-10`); toolchain pinned to one machine's `D:` drive.

**Native layer.** Two app-owned systems: (1) Glass — `GlassViewManager.kt` installs a replacement BlurView controller (`GlassBlurController.kt`, declared inside `eightbitlab.com.blurview` to reach package-private state, `:4,398-412`) with staging-bitmap capture, ~30Hz throttle, crash shields, and an immortal 2s heartbeat (`:111-157`); JS drives freeze/suspend via `navFreeze.js` (wired at `App.jsx:248`). (2) Equalizer — `AuraEqualizerModule.kt` on `android.media.audiofx` with per-route profiles and control-loss events; session id via the RNTP patch. The vendored kotlin-audio fork exists for a notification artwork-bitmap leak fix (`android/settings.gradle:7-8`) plus wake-mode, cache-unit (KB→bytes ×1024, `PlayerCache.kt:18`), session-id, and notification-heart divergences. R8/minification is off (`android/app/build.gradle:79,149`); only arm64-v8a builds (`gradle.properties:42`); release signing key exists solely on the author's machine (`build.gradle:99-111`).

## D. Test coverage

47 suites / ~272 cases (`__tests__/`), driven by a high-quality manual RNTP mock with real queue-index bookkeeping (`__mocks__/react-native-track-player.js:111-189`). No coverage collection, no thresholds, **no CI config in the repo** (no `.github/`). The suite is not runnable in this checkout: `node_modules` absent, and bare `npx jest` pulls jest 30 (devDeps pin `^29.6.3`) and exits 1 silently. `docs/CONTEXT.md:246` claims 46 suites/271 tests passing on the author's machine (one suite stale vs. the 47 on disk).

**Genuinely strong (behavioral, low-mock):** `queueModel` (35 cases — shuffle round-trips, decideNext matrix), `equalizer`+`eqPresets` (25 — resampling math, native-module injection harness), `autoRadio` (15), `auth` (10 — 401-burst coalescing, silent-sign-out regression), `recorder`, `retryPolicy`, `audioQuality`/`autoQuality`, `lyricsSync`, plus three PlayerContext integration suites (restore versioning, gapless-boundary drift by track id).

**Weak or hollow:** `App.test.jsx:10-50` — three tests, **zero assertions**. `deepLinkGuard.test.jsx:30-91` tests a hand-written reimplementation of the URL-parsing hazard, not the shipped `handleLink`. Screen suites mock every API/module boundary, so they verify only the component's own formatting (`screens.test.jsx:18`).

**Conspicuously untested:** `engine.js` — 23 of 24 exports (only `handlePlaybackError`); `service.js` (mocked away); the entire Glass stack (JS + Kotlin); `homeCache.js`; every `src/components/ui/*` and `components/home/*`; all of `src/utils/*`; 6 of 10 hooks; API request/response shaping (every `src/api/*` except `catalog.getTrack` is mocked in every suite that touches it). Nothing exercises `index.js` boot. Production modules carry test-only reset hooks (`_resetImpressionGuard` — which no test even calls, `impressions.js:37-40`).

## E. Risk list (ranked)

Verification status is marked per item. **[V]** = adversarially re-verified by an independent agent instructed to refute it (or read first-hand by me). **[V-adj]** = verified but the original claim was corrected — the corrected form is what's stated. **[1×]** = single-reader finding, not independently checked. 50 findings were re-verified in total; none survived unchanged by default, and three original Tier-1 candidates were demoted here.

### Tier 1 — correctness bugs reachable today
1. **`prev()` applies a stale queue snapshot from inside the op chain** **[V]** — `q` and `idx` are read at press time (`:716-726`) but `applyQueue({...q, idx})` runs *inside* the op after `await engine.getPosition()` (`:737`); `next()` does the same mutation synchronously at `:701`. Double-tapping previous steps back one track instead of two, and any edit landing in between is overwritten by the stale `q`. `src/playback/PlayerContext.jsx:714-742`.
2. **`applyAndSync` drift correction rebases on the pre-mutation snapshot** **[V]** — when the gapless-boundary guard fires it recomputes `mutate({...before, idx: active})` (`:254`), discarding every `applyQueue` landed since (second rapid edit, hydration `:374`, URL freshen `:333`, wake resync `:1177`). `PlayerContext.jsx:232-264`.
3. **`engine.replaceTrack` is the only native-queue mutator that skips `queueLock`, and it never id-checks the slot it writes** **[V-adj]** — it bounds-checks only (`engine.js:335`) where its siblings `loadOntoActive` (`:476`) and `loadAndResume` (`:633`) do an id re-check. *Correction to my earlier framing:* the trigger is **not** concurrent queue edits (the op chain serializes those). It is (a) the auto-quality `remapQueue` timer, which fires every 5s **outside** the op chain (`engine.js:579`) and runs by default since `DEFAULT_QUALITY = 'auto'` (`audioQuality.js:30`), or (b) an ordinary gapless/remote advance during `replaceTrack`'s own awaits (`:340-341`). Consequence: the hydrated track's URL/metadata can be stamped onto whatever song is actually playing. `hydrateAround` targets `q.idx` (`PlayerContext.jsx:354`), so index-equals-active is the common case.
4. **`fetchAuthed`'s 15s deadline silently disables itself whenever a caller passes `signal`** **[V]** — `if (!signal && deadlineMs > 0)` (`src/lib/auth.js:512`). **18 files** create AbortControllers for unmount safety, so the screens that abort correctly are exactly the ones with no timeout — the inverse of the intent, resurrecting the hung-spinner class the deadline was built to kill.
5. **EQ dies silently on audio-session change** **[V]** — stronger than documented. JS stores no session id at all: `attached` is set only by `native.attach()` (`equalizer.js:250`, the id at `:242` is discarded) and cleared only by `lostControl()` (`:218`) or an explicit off-toggle (`:427`). A service/ExoPlayer rebuild leaves `attached === true`, and **every recovery path is gated on `!attached`** — the AppState-foreground re-attach (`:405`) and `probeSession` (`:326`) both bail. The panel keeps showing the switch ON with live faders (`EqualizerPanel.jsx:79,102,179`) over a dead session. The designed fix (P3c) exists nowhere in JS, the native module, or the RNTP patch.
6. **`onPlaybackState` is registered but never dispatched — dead handler** **[V]** — `service.js:86-92` is the one delegating-shaped listener that never reads `handlers.onPlaybackState`; it only calls `mark()`. Key names match on both sides (`PlayerContext.jsx:625,1025`), so this is a missing dispatch, not a typo. The PlaybackException case its own comment describes (state `error`/`none` while `playWhenReady` stays true) is therefore unhandled — **and the dead wiring is masked by a test that mocks the service module and calls the handler directly** (`playerStateAndRestore.test.jsx:19-21`).
7. **No `RemoteDuck` handler anywhere** **[V]** — all 15 RNTP listeners in the repo are accounted for (12 in `service.js`, 3 in `recorder.js`); none covers ducking. Behavior rests entirely on `autoHandleInterruptions: true` (`engine.js:147`). Fine if native focus handling is genuinely wanted — but it's an unstated dependency, not a decision recorded anywhere.
8. **`aura.hasOnboarded` is written but never read** **[V-adj]** — written at `onboarding.js:28` and `auth.js:76`, deleted at `auth.js:103`, read by nothing. *Correction:* the gate `hasOnboarded()` (`auth.js:362-364`) reads a **different persisted** key, `aura.authUser`, via `getUser()` (`:35-45`) — not in-memory state as I first said. So the re-gate window is narrower than feared: a user whose preferences PATCH failed (offline/401/timeout, swallowed at `onboarding.js:24-26`) is re-gated into onboarding on the **next cold start** (`App.jsx:71`), never mid-session.
9. **AlbumScreen renders every track in a non-virtualized ScrollView** **[V]** — `tracks.map` over the unsliced array inside `BounceScrollView` (= `Animated.ScrollView`, `Bounce.jsx:217`) at `AlbumScreen.jsx:54,86-94`, each row mounting a `TrackArt` image. Its three peers (`CatalogPlaylistScreen.jsx:154`, `PlaylistScreen.jsx:486`, `LikedScreen.jsx:174`) all spread `LONG_LIST` onto `BounceFlatList`. `getAlbum` applies no cap (`catalog.js:45-55`). ArtistScreen uses the same ScrollView shape but is capped at 10 rows, which is why only Album is exposed.

### Tier 2 — sign-out does not reset module state (account-switch leak class) **[all V]**
The gate resets exactly two module stores (`App.jsx:96-97`); `clearSession` wipes exactly 10 MMKV keys (`auth.js:100-111`). The sharp point: it *does* delete `aura.talkHistory` and `aura.recentSearches` from disk — but the module-level arrays still hold user A's data in memory and re-persist it under B. Leaks:
10. **Recent searches** — module array read once at load; next account sees and re-persists user A's queries. `src/hooks/useRecentSearches.js:28`.
11. **Talk history** — up to 50 messages of A's conversation seed B's chat; the file's own comment (`useTalkHistory.js:7`) falsely claims sign-out clearing. `useTalkHistory.js:33`.
12. **homeCache** — in-flight fetches repopulate the unowned in-memory cache after a switch, and the cache-hit guard then *suppresses the refetch* for the new user; also no TTL for the whole session. `src/screens/HomeScreen.jsx:96-104,196,245,294`; `src/lib/homeCache.js:10`.
13. **Private session** — `aura.privateUntil` survives sign-out; next account's listening is silently untracked for up to 6h. `src/lib/privateSession.js:7`.
14. **Impression dedup guard** — process-global per-(surface,day) Set survives switches (`src/api/impressions.js:9-23`).
15. **FCM token is never unregistered on sign-out** **[V]** — neither `clearSession` (`auth.js:99-113`) nor `logout` (`:449-460`) deletes the token or tells the server; no unregister path exists anywhere in the client (`push.js` imports `getToken`, never `deleteToken`), and there is no unregister endpoint in the documented push surface. The token stays bound to the signed-out account server-side. The same gap sits on the 401-forced `clearSession` at `auth.js:289`.
16. Related staleness: **TopBar reads auth without subscribing** **[1×]** — mode pill/avatar go stale after profile changes (`src/components/nav/TopBar.jsx:20,54-59`).

### Tier 3 — native/perf fragility
17. **Glass zero-size wedge is only half-fixed** **[V]** — re-init on a zero measure leaves `initialized=true` + `setWillNotDraw(true)`; the heartbeat's revive branch is gated on `!initialized` and can never fire. `GlassBlurController.kt:164-168,117`.
18. **`GlassBlurController.destroy()` is dead code** **[V-adj]** — `GlassViewManager` has no `onDropViewInstance` anywhere, and the only `destroy()` call site (`GlassBlurController.kt:403`) destroys BlurView's *pre-existing* `NoOpController`, not the Glass one. *Correction, and it matters:* the heartbeat does **not** keep ticking after a view drop — BlurView 2.0.6's own `onDetachedFromWindow` disarms capture unconditionally, and `postDelayed` on a detached view parks in the `HandlerActionQueue`. Real (much smaller) fallout: `blurAlgorithm.destroy()` is never called and the two staging/internal bitmaps are never released — they just wait on GC. Demoted from my initial reading.
19. **Dock back-to-top morph animates layout `width` with a Glass child** **[V-adj]** — every layout frame routes through `updateBlurViewSize()` → `init()` (fresh SizeScaler + 2 bitmaps + 2 canvases). Partially mitigated by the goo-window freeze; still per-frame allocation churn. `Dock.jsx:253-260,417`; `GlassBlurController.kt:159-179`.
20. **Vendored kotlin-audio cleanup gaps** **[V-adj]** — `BaseAudioPlayer` declares exactly **one** `MainScope()` (`:91`), never cancelled in `stop()`/`clear()`/`destroy()`; a case-insensitive `cancel` grep over the whole module returns zero hits. *Correction:* this is not "leaking coroutines" — that scope's single `launch` (`:259-279`) has no suspension point and completes. The real defects are (a) `destroy()` (`:456-465`) cannot stop work already dispatched, so the init `launch` can touch an **already-released ExoPlayer**, and (b) the player transitively owns **three more never-cancelled scopes** (`NotificationManager`, `PlayerEventHolder`, `NotificationEventHolder`) where indefinite suspension *is* possible. Also: `PlayerCache` static survives `SimpleCache` release (`PlayerCache.kt:12`) **[1×]**; `getAudioItemHolder()` is a double-unsafe `!!`+cast on every notification/queue read (`MediaItemExt.kt:7`) **[1×]**; `QueuedAudioPlayer.nextItems` off-by-one (`:56`) **[1×]**.
21. **AddToPlaylistSheet fires one `getPlaylist` per playlist on open** (N+1) **[V-adj]** — no cache, no dedup, no batching anywhere in the path (`AddToPlaylistSheet.jsx:43-67`; `fetchAuthed` is plain `fetch`), and `key={event.id}` (`:286`) forces a remount every open so nothing survives reopening. *Correction:* the fan-out is gated behind `single` (`:48`), so multi-track opens from QueueSheet issue zero — but two of three call sites pass a single track, so it is the common path.
22. **Search never aborts in-flight requests** **[1×]** despite the client supporting `signal` (`SearchScreen.jsx:142-146`); stale results only masked by key-matching.
23. **Boot telemetry ships a Sentry event on 100% of cold starts** **[V]** — `SAMPLE = 1.0` with its own "dial down once baselines are collected" note (`src/lib/perfMarks.js:12,17,35-37`).
24. **Auto-radio queue growth is uncapped** and every queue change re-serializes the whole queue synchronously on the JS thread (400ms debounce) **[V-adj]** — real mechanism, but magnitude is tens of KB per write over an 8h session, not the runaway I first implied (`queueModel.js:206-223`; `PlayerContext.jsx:1253-1272`).
25. **~78 MB retained after browsing a 289-track playlist — measured, repeatable, unattributed** (`reports/05-attribution.md:23-32`; first hypothesis retracted in `reports/08-spotted.md`). Item 9 (AlbumScreen) is a plausible sibling worth testing against it.

### Tier 4 — security & operational config
26. **JWT + full user profile in unencrypted default MMKV** — no `encryptionKey`, no client-side expiry; mitigated by `allowBackup=false`. `src/storage/mmkv.js:5`, `auth.js:12,94`.
27. **AdminCompose is client-gated only** — route registered unconditionally, screen does no check; server-side allowlist is asserted only in a comment (`push.js:183`) and unverifiable here. `RootTabs.jsx:116-120`, `AdminComposeScreen.jsx:71`, `YouScreen.jsx:341` (verified, severity depends on server).
28. **Deep-link handler has no origin allowlist** and is fed by two untrusted paths: the exported `singleTask` activity (explicit-component intents bypass host filters) and FCM `data.link` free text from the admin console. `App.jsx:119-190`; `AndroidManifest.xml:59-61`.
29. **`<profileable android:shell="true">` ships in release** — any ADB-authorized host can capture the app's memory (where the JWT lives). `AndroidManifest.xml:30`. Left over from the leak hunt.
30. **Sentry default breadcrumbs record outgoing fetch URLs** — playlist invite tokens ride in URLs (`api/playlists.js:108-111`); no `beforeSend` scrubber (`index.js:26-32`).
31. **Release is unsignable from a clean clone** — key + `keystore.properties` exist only on the author's machine; build hard-wired to a Windows `D:` toolchain and cmd.exe-only npm scripts (`android/app/build.gradle:99-111`; `scripts/env.cmd`; `package.json:6-10`). With no CI, the bus factor on shipping is 1.
32. Committed Firebase client config (standard practice, but confirm API-key restrictions in GCP) — `google-services.json:18`. `usesCleartextTraffic` placeholder resolves outside the repo (RN plugin default: false in release) — `AndroidManifest.xml:22`. Unguarded `res.json()` on all unauthenticated auth endpoints throws SyntaxError on non-JSON 5xx (`auth.js:121,139,171,199,220`).

### Tier 5 — duplication, dead code, doc rot (headline items; all verified)
33. **Resume-position guard duplicated with reordered predicates** — `PlayerContext.jsx:105-119` vs `usePlaybackProgress.js:16-23`; the docs call it a landmine (`docs/CONTEXT.md:287`).
34. **MMKV key literals `aura.queue`/`aura.position` retyped in 5 modules** — a rename compiles and tests green while the progress seed, presence, and sign-out purge go blind. `PlayerContext.jsx:46-47`; `usePlaybackProgress.js:13-14`; `PresenceAgent.jsx:19`; `queueDrift.js:46`; `auth.js:107-108`.
35. **Eight screens copy-paste the same AbortController-fetch-into-`hit` block, already forked into two error dialects** (`AlbumScreen.jsx:28-38` et al.); the 150ms find-debounce + sort scaffolding is triplicated (`LikedScreen.jsx:48-63` etc.); **two confirm dialogs** with byte-identical-then-diverged styles, only one honoring `danger` (`ConfirmSheet.jsx:60-99` vs `ConfirmPopup.jsx:104-173`); ModeSheet ≡ QualitySheet (`ModeSheet.jsx:45-103` vs `QualitySheet.jsx:35-85`); nine 16-line event buses in two dialects; home rails share a copy-pasted malformed ScrollView shell (`ArtistRail.jsx:13-17` = `MemoryRail.jsx:13-17`).
36. **Three coach-mark systems with three storage schemes, two fired back-to-back for the same physical gesture** — `PlayerSheet.jsx:713-714` calls `markHintDone` + `noteTourGesture` for one action (`hints.js`, `tapHint.js`, `gestureTour.js`).
37. **Shared MMKV sort key with independently-declared SORTS arrays** in PlaylistScreen (`:70-76`) and CatalogPlaylistScreen (`:31-37`).
38. **Dead code**: `onPlaybackState` handler registered but `service.js:86-92` never invokes it (`PlayerContext.jsx:625,1025`); `OnboardingScreen`'s `pool` prop (`App.jsx:241`); `likesReady()` (`useLikes.js:42-44`); `_resetImpressionGuard()`; vendored non-queued `AudioPlayer.kt`; Android-Studio template resources shipped into the APK (`kotlin-audio/res/values/colors.xml`); 4 unused design tokens + 14 hardcoded font-family bypasses (`tokens.js:62,73-77,90,112,114`); `HOME_LANGS` copy of `PRIMARY_LANGUAGES` under a comment naming the source (`YouScreen.jsx:76-85`).
39. **Doc rot**: `docs/CONTEXT.md` is excellent but stale — fetchAuthed "no timeout" claim now false (`:79` vs `auth.js:505`), line numbers drifted 2-40 lines repo-wide, LOC/suite counts off; README is untouched RN boilerplate; `UPSTREAM.md` table broken mid-file (`:43`); closed findings not amended in the originals (`reports/02-review.md:39` vs `reports/07-changelog.md:132`).
40. **Demoted after verification** (were Tier 1 candidates; kept for the record so they aren't re-investigated):
   - *PlaylistsScreen delete-vs-leave* **[V-adj]** — the ⋯ action really does use a narrower predicate (`p.role === 'owner'`, `:222`) than the owned/joined partition (`!p.shared || p.role === 'owner'`, `:194`), and one shared `renderRow` feeds both sections. But no in-repo path or documented API shape produces the divergent row (`shared` falsy + `role !== 'owner'`), so it is **latent hardening**, not a live bug — the closest exposure is the un-normalized optimistic create-prepend at `:135`.
   - *Near-end freshen marker* **[V-adj]** — the `.catch` at `PlayerContext.jsx:336-339` does reset `freshenedRef.current = null` unconditionally, so a failed fetch for track A can wipe a marker installed for B. Cost is **one redundant `getTrack(fresh:true)`**, never a wrong-URL swap — the id check at `:327` still blocks that. Low.
41. Positive verified negatives: **no orphan screens, no unimported modules, no TODO/FIXME/HACK markers in app code**; sentry.properties/env.cmd/git history clean of tokens; release is *not* debug-signed.

## F. Unknowns & questions

**Could not determine from this repo:**
- **Everything server-side.** The `web` repo (Express app, DB schema, admin allowlist, rate limits, push send path, JioSaavn proxy) is absent; all `/api/*` contracts here are inferred from call sites, and every `web/server/*` citation in `docs/` is unverifiable. Whether `/api/admin/push/send` really re-checks an allowlist (asserted at `push.js:183`) is the biggest open security question.
- **History.** The clone is shallow (50 commits) and most of the tree lands in one squashed audit commit (`70e10b3`); the kotlin-audio fork records **no upstream base commit** anywhere (`reports/02-review.md:157`), so fork-vs-upstream diffing and "fixed in commit X" claims can't be verified.
- **Anything requiring `node_modules` or a device**: whether the test suite passes at HEAD, the resolved AGP/RN-plugin versions, `${usesCleartextTraffic}` resolution, BlurView library internals (binary dep), whether the ColorOS leak fix still holds after the ~19 subsequent glass commits, and the unattributed 78 MB retention.
- Whether `aurafm.live/.well-known/assetlinks.json` matches the release-key fingerprint (App Links `autoVerify` depends on it).

**Open questions for the owner:**
1. Can the `web` repo be made available alongside this one? Half of any real
   debugging ends at the API seam.
2. Is multi-account use on one device a real scenario? The Tier 2 leak class is
   only cosmetic if devices are single-user in practice. *(Fixed regardless —
   see status below.)*
3. Is the kotlin-audio fork's upstream base commit recorded anywhere off-repo?
   It determines whether upgrading is feasible at all.
4. Where do tests and builds actually run — only the author's Windows machine?
   There is no CI config in the repo. Is that intentional?
5. Is ColorOS/OnePlus still the fleet to optimize for, and is the >99.5%
   crash-free figure in the docs the bar to hold?

---

## Status since this audit

Worked in the same session, on `claude/session-takeover-wwu0wy`. Everything below
is verified by `npm test` (50 suites / 298 tests) and lint unless marked
otherwise. **No Kotlin in this session was compiled** — the container had no
Android SDK — so every native change is review-only until a real build.

**Closed**

| Item | Where |
|---|---|
| T3 #17 — glass zero-size wedge (transparent top bar after a detail-screen round-trip) | `GlassBlurController.init()` resets `initialized`, so the heartbeat's revive branch can reach it |
| T2 #16 — TopBar read identity without subscribing (stale mode pill, stale avatar) | `TopBar.jsx` subscribes to auth |
| T3 #19 — dock morph reallocated blur bitmaps per frame | `init()` keeps buffers when the scaled size is unchanged |
| T2 #10-15 — all six sign-out leaks | new `lib/sessionReset.js` registry; stores register their own teardown |
| T1 #1 — `prev()` resolved its target at press time | resolved inside the op |
| T1 #2 — drift correction rebuilt from a stale `before` | rebased on the live queue |
| T1 #3 — `replaceTrack` skipped the lock, never id-checked | takes the lock, verifies id, re-confirms the active row |
| Notification heart icon frozen on OEM media cards | both icons pre-registered; `getCustomActions` selects |
| Foreground and data-only pushes never reached the shade | new `AuraNotifier` app-local module |
| `_resetImpressionGuard` dead since it was written | now the impression store's session teardown |

**Corrected by later evidence**

- **T1 #7 (`remote-duck`)** was understated. RNTP does not merely lack a handler
  — it *emits* `"remote-duck"` on every audio-focus change
  (`MusicService.kt:673-681`), `Event.RemoteDuck` exists in the enum, and the app
  has zero listeners. The event is produced and dropped.
- **T1 #6 (`onPlaybackState`)** — still open, and worth knowing that a test masks
  it: `playerStateAndRestore.test.jsx` mocks the service and calls the handler
  directly, so the missing dispatch is invisible to the suite.

**Still open** — the whole of Tier 4 (security/ops), `onPlaybackState`, the EQ
audio-session re-attach (P3c), `remote-duck`, `aura.hasOnboarded`, AlbumScreen
virtualization, and all of Tier 5. Also: `npm run lint` fails on a clean tree
(`AbortSignal is not defined`, `__tests__/auth.test.js:45`) — one line in the
eslint globals, left alone here as unrelated to any reported bug.
