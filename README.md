# AURA — native

The Android app for AURA, a personal music-streaming service. React Native
0.83 / React 19 on Hermes with the New Architecture (Fabric + TurboModules),
`arm64-v8a` only. No iOS target.

This is one half of a two-repo system. Everything the app shows comes from a
companion web repo that is **not in this checkout** and serves
`https://www.aurafm.live` — an Express API on Vercel over Neon Postgres, with
the music catalog proxied from JioSaavn. If a question ends at `/api/…`, the
answer is in the other repo.

## What it does

Streams the catalog with fixed and adaptive quality; a client-owned queue with
drag-reorder and endless "auto-radio" continuation; synced lyrics and karaoke
with instrumental stems; likes and collaborative playlists; listening insights
(journal, "sonic DNA", music clock); mood "bridges"; an LLM DJ chat ("Talk"); a
native equalizer with volume leveling; FCM push with an in-app admin composer;
and cross-device presence and resume.

There is no local database. Durable client state is a few dozen MMKV string
keys — the shared ones are declared in `src/storage/keys.js`. There is no env
layer either: the API origin and the Sentry DSN are hardcoded
(`src/lib/auth.js`, `index.js`).

The chrome is a native "glass" capture-blur stack (a patched BlurView pipeline
in Kotlin) plus Skia "goo" effects.

## Getting oriented

Read in this order:

| Document | What it gives you |
|---|---|
| `docs/CONTEXT.md` | The system map — module layout, the API seam, the native stack. It is a snapshot; read its freshness banner first. |
| `reports/11-onboarding-audit.md` | Current state: feature inventory, architecture, test coverage, and the ranked risk list with what is closed and what is deliberately not. |
| `UPSTREAM.md` | Which files are ports of the web app, and what was adapted. Sync a web change by diffing the pair. |
| `docs/OPTIMIZATION-PLAYBOOK.md`, `docs/perf/` | The performance work and how it was measured. |
| `reports/` | The investigation record — each report is a hunt, and records what was ruled out as well as what was found. |

Two things worth knowing before changing anything:

- **`android/kotlin-audio/` is a vendored fork** of doublesymmetry/kotlin-audio
  that `react-native-track-player` builds against, and no upstream base commit
  is recorded anywhere. Diffing it against upstream is not currently possible.
- **`patches/` is load-bearing.** `patch-package` runs on `postinstall`. When
  the patch fails to apply, the usual cause is a stale `node_modules` — remove
  `node_modules/react-native-track-player` and reinstall.

## Working on it

```sh
npm install        # runs patch-package on postinstall
npm test           # jest
npm run lint       # eslint — expected to pass clean on the whole tree
npm start          # metro
```

Android builds go through `scripts/env.cmd`, which pins the toolchain to a
`D:\` layout, so the `android:*` scripts are **cmd.exe only** — `call` is a cmd
builtin and PowerShell fails it. Run `android\gradlew.bat` directly from
PowerShell, or use cmd.

```sh
npm run android:release   # assembleRelease
npm run android:install   # adb install -r  (keeps app data; a debug build would not)
```

Release signing needs a keystore and a `keystore.properties` that are
deliberately not in the repo, so **a clean clone cannot produce a signed
release build.** That is a known gap, recorded in the audit.

## Tests

`jest.config.js` + `jest.setup.js`. The suite covers the queue model, playback
engine paths and failure cascades, retry policy, the track cache, the deep-link
guard, storage-key and session-reset invariants, playlist and detail screens,
lyric sync, audio quality, leveling and the music clock.

`react-native-track-player` has a hand-written manual mock
(`__mocks__/react-native-track-player.js`) with `__emit`, `__setProgress` and
`__resetMock`, so service-level specs can drive real event flows.

Two habits that keep this suite honest, both learned the hard way here:

- **Module state outlives a test.** Stores in this app are singletons by
  design, and several specs have leaked into their neighbours through a
  module-scope cache or a buffered toast. Reset what you touch in `beforeEach`.
- **A passing test proves nothing until it has failed.** More than one test in
  this repo's history passed with its fix reverted. Check that a new test
  actually discriminates.
