# AURA Native — Caching Architecture (Phase 2)

*Driven by field evidence (01 §6): play-tap → audio 2–3 s; multi-second transition gaps.
Root constraint: stream URLs are short-lived upstream CDN links, so nothing was cached
anywhere. Every layer below names store, bound, eviction, invalidation, and location.*

## Layers

**1. Resolved track objects (metadata + streamUrl) — THE fix for both symptoms.**
- Store: MMKV (`aura.trackCache.v1`), single JSON map id → `{track, fetchedAt}`, plus an
  in-memory mirror. Lives inside `src/api/catalog.js` `getTrack` — one choke point, every
  caller (boot restore, hydrateAround, deep links, picks) inherits it.
- Policy: fresh < **15 min** → return cached instantly (no network); stale → return
  cached *for metadata* only if offline, else refetch. LRU cap **150 entries** (~300 KB);
  trim on write.
- Hit-rate expectation: near-100 % for the boot-restore pair (persisted idx/idx+1 were
  fetched during the previous session's tail) and for repeat plays within a session.
- Staleness risk: an expired URL served from cache → playback error → the existing
  recovery refetches ONCE with a bypass flag (already built, `engine.js:549`); the retry
  ladder (03) narrows the audible cost. TTL 15 min is deliberately far under observed
  upstream validity (hours) — wrong-TTL failure mode is a silent extra refetch, never a
  broken session.

**2. Next-track freshness at the transition (gap killer).**
- `hydrateAround` fetches idx+1 when it *becomes* next — up to a full song before it
  plays, and replaceTrack near song end would discard ExoPlayer's prebuffer.
- New rule in `PlayerContext.onProgress`: in the last **~25 s** of the current track,
  if next's URL is older than TTL, refresh + `replaceTrack` THEN (early enough for
  prebuffer to redo its work; late enough to be one refresh per song). No-op when fresh.

**3. Media/audio disk cache (ExoPlayer SimpleCache).**
- Already plumbed end-to-end (RNTP `maxCacheSize` KB → kotlin-audio `CacheConfig` →
  `CacheDataSource`), just never enabled. Enable at **262144 KB (256 MB)**, ExoPlayer
  LRU eviction. Serves: repeat plays start from disk (<200 ms budget line), seek-back,
  resume-from-cache mid-track on network flaps (`FLAG_IGNORE_CACHE_ON_ERROR` already set
  in kotlin-audio). Invalidation: keyed by URL; a re-resolved URL naturally misses —
  acceptable, the cache is a bandwidth/latency win, not a correctness layer.
- What breaks if wrong: disk pressure — bounded at 256 MB; storage-full devices evict.
- **Unit trap (found in review, fixed in `PlayerCache.kt`):** the KB contract above is
  real, but kotlin-audio handed the number straight to `LeastRecentlyUsedCacheEvictor`,
  which takes BYTES. For its first release this layer was a 256 **KB** cache — two
  seconds of audio, i.e. inert. The conversion now happens at that boundary.

**4. Buffer window.** `minBuffer 30 / playBuffer 2.5 / maxBuffer 120` (seconds): faster
start (play begins at 2.5 s buffered), and a 120 s forward window means ExoPlayer
finishes the current item early and starts prebuffering the NEXT item well before the
boundary — the other half of the gap fix. Battery cost: radio finishes sooner per song
(bursts), not more total data.

**5. Artwork.** RN `Image` disk/memory cache already covers it; `service.js` already
prefetches the next track's 150px art at track change (field-report fix). No new layer;
decode sizing stays at the 150/500 px variants already in use.

**6. Playback snapshot (instant-open UI).** Already done: queue + position in MMKV,
read synchronously before first frame (f344252). Write cadence: queue on mutation,
position 5 s debounce + flush on pause — unchanged.

**7. Queue, search, EQ settings.** Queue: persisted on every mutation (exists). EQ:
in-memory + MMKV singleton (exists, never re-read per track). Search recents: existing
web-parity store; catalog search responses stay server-cached — client TTL cache is
NOT added now (low repeat rate, honest skip).

**8. Network layer.** Single origin (`www.aurafm.live`), OkHttp keep-alive + HTTP/2 by
default on Android; TLS session reuse comes free. The dominant cost is the serverless +
upstream round-trip itself — attacked by layer 1 (skip the request), not by tuning.

## Warm-start path (in order, JS thread, first frames)
1. MMKV reads (sync, µs): queue, position, EQ, settings → UI renders complete.
2. `setupPlayer` (op chain) → engine exists.
3. Track cache: idx/idx+1 fresh? → `syncQueue` immediately (no network) → **play-tap is
   instant**; else fetch (today's path), background-refresh if stale-but-present.
4. Deferred: profile refresh, push init, home cache — already off the critical path.
