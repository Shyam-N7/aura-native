import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { storage } from '../storage/mmkv';
import { showToast } from '../lib/toast';
import { isSignedIn, subscribeAuth } from '../lib/auth';
import { ensurePushPermission } from '../lib/push';
import {
  fireEndOfSetIfArmed,
  subscribeSleepFire,
  tickSleepTimer,
} from '../lib/sleepTimer';
import { getAudioQuality, setAudioQuality } from '../lib/audioQuality';
import {
  getLeveling,
  setLeveling as storeLeveling,
  gainFor,
} from '../lib/leveling';
import { getTrack, trackCacheAge } from '../api/catalog';
import { mark } from '../lib/perfMarks';
import { report } from '../lib/crumbs';
import { dumpQueueDrift } from '../lib/queueDrift';
import { getLoudness, requestMeasure } from '../api/loudness';
import { prefetchLyrics } from '../api/lyrics';
import { useLikes } from '../hooks/useLikes';
import * as engine from './engine';
import * as model from './queueModel';
import * as autoRadio from './autoRadio';
import { registerHandlers } from './service';
import { startRecorder } from './recorder';

// Owns the app queue state { tracks, idx, source } and keeps it mirrored into
// the RNTP engine. All playback intents (screens, MiniBar, PlayerSheet,
// notification remotes via the service) flow through here so the model and
// the native queue can never disagree for long: user actions mutate the model
// first and push to the engine; native-initiated changes (auto-advance, error
// auto-skip) flow back through onActiveTrackChanged.

const QUEUE_KEY = 'aura.queue';
const POSITION_KEY = 'aura.position';
const REPEAT_KEY = 'aura.repeat';
// Persisted-shape version (autoRadio's aura.autoNext.v1 pattern). Stamped
// INSIDE the payload, not on the key: a renamed key would silently drop every
// existing user's queue, and a queue is theirs. A payload from a shape we
// don't know is dropped; one with no version at all is the pre-versioning
// write of this same shape, so it restores.
const QUEUE_VERSION = 1;

function loadStoredQueue() {
  try {
    const raw = storage.getItem(QUEUE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tracks) || !parsed.tracks.length) {
      return null;
    }
    if (parsed.v != null && parsed.v !== QUEUE_VERSION) {
      return null;
    }
    // An id-less entry is permanently unplayable: engine.toRntpTrack stamps it
    // with the dead PENDING_URL, hydrateAround skips it (no id to fetch), and
    // the error recovery refetches by undefined id — a dead row nothing can
    // ever get past. Drop those alone; the rest of the queue is still theirs.
    const tracks = parsed.tracks.filter(t => t?.id);
    if (!tracks.length) {
      return null;
    }
    const rawIdx = Number.isFinite(parsed.idx) ? parsed.idx : 0;
    // Survivors before the saved spot ARE its new index; if the saved entry
    // was itself dropped this lands on the next one, the same way removeAt
    // slides the following track in.
    const idx = parsed.tracks.slice(0, rawIdx).filter(t => t?.id).length;
    return model.createQueue(tracks, idx, parsed.source || "tonight's set");
  } catch {
    return null;
  }
}

function readStoredRepeat() {
  const v = storage.getItem(REPEAT_KEY);
  return v === 'all' || v === 'one' ? v : 'off';
}

function readStoredPosition() {
  try {
    const raw = storage.getItem(POSITION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Where a restored queue should start playing: the saved spot, but only when
// it still belongs to this track and isn't at either end (a nearly-finished
// track is better restarted than resumed 2 seconds from the outro).
function storedPositionSec(queue) {
  const saved = readStoredPosition();
  const cur = queue?.tracks?.[queue.idx];
  if (
    saved &&
    cur &&
    saved.trackId === cur.id &&
    saved.progress > 0.01 &&
    saved.progress < 0.98 &&
    cur.durationSec > 0
  ) {
    return saved.progress * cur.durationSec;
  }
  return undefined;
}

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const [queue, setQueueState] = useState(
    () => loadStoredQueue() ?? model.createQueue([], 0, "tonight's set"),
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [repeat, setRepeat] = useState(readStoredRepeat);
  const [shuffleActive, setShuffleActive] = useState(false);
  // Pre-shuffle order snapshot, held while shuffle is on so turning it off
  // can restore the queue (model.restoreOrder). Null whenever shuffle is off
  // or the queue was replaced — a new queue owns its own order.
  const preShuffleRef = useRef(null);
  const [quality, setQualityState] = useState(getAudioQuality);
  const [leveling, setLevelingState] = useState(getLeveling);
  // Karaoke "music only" — true while the active track plays its instrumental.
  const [musicOnly, setMusicOnlyState] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);

  // Refs let the service/engine event handlers (subscribed once) read live
  // state without re-registering, mirroring the web viewRef pattern.
  const queueRef = useRef(queue);
  const repeatRef = useRef(repeat);
  const isPlayingRef = useRef(isPlaying);
  repeatRef.current = repeat;
  isPlayingRef.current = isPlaying;

  // Engine calls are async; a single promise chain keeps queue mutations from
  // interleaving (rapid next-next, remove during an append, …).
  const opChain = useRef(Promise.resolve());
  const enqueueOp = useCallback(op => {
    opChain.current = opChain.current.then(op).catch(err => {
      console.warn('[player] engine op failed', err?.message ?? err);
      // Where model/native divergence is BORN: the mutation already landed in
      // the React model (and from there in MMKV), and the push to the engine
      // just failed. Nothing downstream reconciles the two, so the queue the
      // user sees and the queue that plays have quietly parted. Not a dead end
      // the user feels in the moment, which is why it was easy to miss — but
      // it is the one event that explains a whole class of "wrong song" and
      // "my reorder didn't stick" reports.
      report(err, 'player.engine-op-failed');
    });
    return opChain.current;
  }, []);

  // Play-INTENT ops must not die as a console.warn (field report: after a
  // system kill, tapping play did nothing). One quiet retry after rebuilding
  // the native queue from the model — the post-kill dead state is exactly
  // "model full, native empty". If it still fails, own up instead of showing
  // a playing state over silence: honest pause + a toast that names the fix.
  const enqueuePlayOp = useCallback(
    op =>
      enqueueOp(async () => {
        try {
          await op();
        } catch (err) {
          console.warn('[player] play op failed, retrying', err?.message ?? err);
          try {
            const q = queueRef.current;
            if (q.tracks.length) {
              // Carry the saved spot: storedPositionSec answers only when the
              // saved position belongs to the CURRENT model track, so
              // skip-style ops (whose idx already moved on) get no seek —
              // only a same-track rebuild resumes mid-song instead of 0:00.
              await engine.syncQueue(q, {
                startIndex: q.idx,
                positionSec: storedPositionSec(q),
              });
            }
            await op();
          } catch (err2) {
            console.warn('[player] play op failed twice', err2?.message ?? err2);
            // Second failure after a full native-queue rebuild — the field
            // report this retry was built for ("tapping play did nothing")
            // happening anyway. Worth an event: it is silence the user is
            // staring at.
            report(err2, 'player.play-op-failed');
            setIsPlaying(false);
            showToast("couldn't play — tap play to try again.");
          }
        }
      }),
    [enqueueOp],
  );

  const applyQueue = useCallback(nextQueue => {
    queueRef.current = nextQueue;
    setQueueState(nextQueue);
  }, []);

  // The one shape every queue edit goes through: mutate the model, paint it,
  // then push it to the engine behind the gapless-boundary guard.
  //
  // `mutate` must be PURE — it runs once for the optimistic paint, and again
  // inside the op if the guard fires.
  //
  // The guard: a mutation is computed against the model's idea of what is
  // playing, but by the time its op reaches the front of the chain the native
  // player may have moved on — its event lands a beat later, and with the
  // screen off that backlog can run to whole tracks (see the wake resync).
  // Push the stale index and syncQueue rebuilds around a song that already
  // finished, so the audio jumps backwards: remove a row in the last second
  // of a track and the next one restarts as the previous one. Re-read the
  // active index, and if it moved, recompute the SAME mutation from the track
  // that is actually playing. clearQueue carried this guard alone while six
  // siblings went without; having exactly one copy is the point.
  //
  // Returns whether anything changed, so callers can gate their own side
  // effects (toasts, shuffle bookkeeping) on a real edit.
  const applyAndSync = useCallback(
    (before, mutate) => {
      const nq = mutate(before);
      if (nq === before) {
        return false;
      }
      applyQueue(nq);
      enqueueOp(async () => {
        const active = await engine.getActiveIndex();
        if (active != null && active !== before.idx && before.tracks[active]) {
          // The index alone can lie: mid-rebuild it reads as a transient
          // (engine.getActiveTrack's caveat), and recomputing around a lie
          // repoints the queue at a song that was never playing — seen live
          // as a paused reorder stepping the now-playing row. Drift is real
          // only when the native ACTIVE TRACK is genuinely a different song
          // than the model's, and is the song the index claims it is.
          const nativeTrack = await engine.getActiveTrack();
          const drifted =
            nativeTrack?.id != null &&
            nativeTrack.id !== before.tracks[before.idx]?.id &&
            before.tracks[active]?.id === nativeTrack.id;
          if (drifted) {
            const fixed = mutate({ ...before, idx: active });
            applyQueue(fixed);
            return engine.syncQueue(fixed, { startIndex: fixed.idx });
          }
        }
        return engine.syncQueue(nq, { startIndex: nq.idx });
      });
      return true;
    },
    [applyQueue, enqueueOp],
  );

  // ── position persistence ({ trackId, progress } fraction, 5s debounce) ──
  const posPending = useRef(null);
  const posTimer = useRef(null);
  // Which next-track id the near-end freshness check already handled — one
  // refresh per upcoming track, not one per progress tick.
  const freshenedRef = useRef(null);
  const flushPosition = useCallback(() => {
    if (posTimer.current) {
      clearTimeout(posTimer.current);
      posTimer.current = null;
    }
    if (posPending.current) {
      storage.setItem(POSITION_KEY, JSON.stringify(posPending.current));
      posPending.current = null;
    }
  }, []);
  const clearPosition = useCallback(() => {
    if (posTimer.current) {
      clearTimeout(posTimer.current);
      posTimer.current = null;
    }
    posPending.current = null;
    storage.removeItem(POSITION_KEY);
  }, []);
  const onProgress = useCallback(
    e => {
      // Screen-off-reliable sleep check: RNTP progress events keep coming
      // every second while playing, even when JS interval timers are stalled.
      tickSleepTimer();
      if (!(e?.duration > 0)) {
        return;
      }
      const q = queueRef.current;
      const t = q.tracks[q.idx];
      // e.track is the RNTP queue index — skip ticks from a transient
      // model/native mismatch so the wrong track never claims the position.
      if (!t || (e.track != null && e.track !== q.idx)) {
        return;
      }
      posPending.current = { trackId: t.id, progress: e.position / e.duration };
      if (!posTimer.current) {
        posTimer.current = setTimeout(flushPosition, 5000);
      }
      // Transition-gap guard (docs/perf/02 layer 2): the next track's URL was
      // resolved when it BECAME next — up to a whole song ago — and a stale
      // link erroring at the boundary is seconds of silence while recovery
      // refetches. In the last ~25s, if next's URL has aged past the cache
      // TTL, re-resolve and swap it in now: early enough for ExoPlayer to
      // redo its prebuffer, late enough to be at most one refresh per song.
      if (e.duration - e.position < 25) {
        const nxt = q.tracks[q.idx + 1];
        if (
          nxt?.id &&
          freshenedRef.current !== nxt.id &&
          (trackCacheAge(nxt.id) > 14 * 60 * 1000 || !nxt.streamUrl)
        ) {
          freshenedRef.current = nxt.id;
          const at = q.idx + 1;
          getTrack(nxt.id, { fresh: true })
            .then(fresh => {
              const live = queueRef.current;
              if (!fresh?.streamUrl || live.tracks[at]?.id !== fresh.id) {
                return;
              }
              const tracks = live.tracks.map(x =>
                x.id === fresh.id ? { ...x, ...fresh } : x,
              );
              applyQueue({ ...live, tracks });
              enqueueOp(() => engine.replaceTrack(at, tracks[at]));
            })
            .catch(() => {
              // next tick retries; worst case the boundary pays the old cost
              freshenedRef.current = null;
            });
        }
      }
    },
    [flushPosition, applyQueue, enqueueOp],
  );

  // ── lazy stream-URL hydration ────────────────────────────────────────────
  // Persisted tracks lose streamUrl (CDN tokens rotate); fetch fresh URLs for
  // the current + next track as they come into play and swap them into the
  // engine. bootedRef keeps this quiet until the cold restore has run.
  const bootedRef = useRef(false);
  const hydratingRef = useRef(new Set());
  const hydrateAround = useCallback(
    q => {
      [q.idx, q.idx + 1].forEach(i => {
        const t = q.tracks[i];
        if (!t?.id || t.streamUrl || hydratingRef.current.has(t.id)) {
          return;
        }
        hydratingRef.current.add(t.id);
        getTrack(t.id)
          .then(fresh => {
            hydratingRef.current.delete(t.id);
            if (!fresh?.streamUrl) {
              return;
            }
            const live = queueRef.current;
            const at = live.tracks.findIndex(x => x.id === fresh.id);
            if (at < 0) {
              return;
            }
            const tracks = live.tracks.map(x =>
              x.id === fresh.id ? { ...x, ...fresh } : x,
            );
            applyQueue({ ...live, tracks });
            enqueueOp(() => engine.replaceTrack(at, tracks[at]));
          })
          .catch(() => hydratingRef.current.delete(t.id));
      });
    },
    [applyQueue, enqueueOp],
  );

  // A user action during the cold restore window wins over the restore.
  // Declared above the auto-radio block: playAutoNext is a user intent too.
  const userActedRef = useRef(false);

  // ── auto-radio ───────────────────────────────────────────────────────────
  // Render mirror of the prefetch store: on the last track of a queue there's
  // no next track to show, so the player reads this to surface the
  // continuation it's about to play (or "finding next song" while it resolves).
  // Subscribing here — above the noteQueueState effect — means the first
  // prefetch of a session can't publish before we're listening.
  const [autoNext, setAutoNext] = useState(autoRadio.getAutoNext);
  const autoNextRef = useRef(autoNext);
  useEffect(
    () =>
      autoRadio.subscribe(s => {
        autoNextRef.current = s;
        setAutoNext(s);
      }),
    [],
  );

  // The continuation as the queue should SHOW it: deduped against the live
  // queue, so the list is exactly what gets appended and row i is exactly
  // queue position idx + 1 + i. (Web lists the raw candidates and dedupes only
  // on apply, so a dropped cover silently shifts what its rows play.) Null
  // unless the batch is actually reachable — off the last track, on a wrapping
  // source, or under repeat, it would never play.
  const autoNextTracks = useMemo(() => {
    const seed = queue.tracks[queue.idx];
    // Shown while the batch's SEED is still the current track — not only at
    // the queue's end: queueing a pick used to vanish the rest of the batch
    // (field report). Queued picks drop out of the shown list via the dedupe;
    // when playback moves onto them the seed check hides the stale batch
    // until the new last track's prefetch replaces it.
    if (
      !autoNext.candidates?.length ||
      !seed?.id ||
      autoNext.seedId !== seed.id ||
      queue.source === "tonight's set" ||
      repeat !== 'off'
    ) {
      return null;
    }
    const extended = model.dedupeAppend(queue, autoNext.candidates);
    return extended === queue ? null : extended.tracks.slice(queue.tracks.length);
  }, [autoNext, queue, repeat]);

  // Play the batch starting from row `offset` (web consumeAutoNext's jump).
  // Recomputed from the live refs rather than trusting the rendered list, so a
  // queue edit between paint and tap can't append against a stale queue.
  // Insert ONE track at an exact queue position — how a single up-next pick
  // is pulled into the queue (drag-drop or move-to-top) without adopting the
  // whole batch. The engine sync's same-current tier splices around the
  // active item, so audio never hiccups.
  const insertTrackAt = useCallback(
    (track, at) => {
      if (!track?.id) {
        return;
      }
      userActedRef.current = true;
      const q = queueRef.current;
      if (q.tracks.some(x => x.id === track.id)) {
        return; // already queued — dedupe rule, same as dedupeAppend's
      }
      applyAndSync(q, base => {
        const pos = Math.max(0, Math.min(at, base.tracks.length));
        const tracks = [...base.tracks];
        tracks.splice(pos, 0, track);
        return {
          ...base,
          tracks,
          idx: pos <= base.idx ? base.idx + 1 : base.idx,
        };
      });
    },
    [applyAndSync],
  );

  // Keep the batch, keep listening: AURA's picks become REAL queue rows — so
  // they can be dragged, removed, moved to top like anything else — while the
  // current song plays on untouched. The engine sync's same-current tier
  // appends around the active item, so audio never hiccups; autoRadio then
  // prefetches the continuation past the new end, same as any queue.
  const adoptAutoNext = useCallback(() => {
    userActedRef.current = true;
    const q = queueRef.current;
    const candidates = autoNextRef.current?.candidates;
    if (model.dedupeAppend(q, candidates) === q) {
      return;
    }
    autoRadio.reset();
    applyAndSync(q, base => model.dedupeAppend(base, candidates));
  }, [applyAndSync]);

  const playAutoNext = useCallback(
    (offset = 0) => {
      // A user intent like every other — without this, a cold restore still in
      // flight replays its stale queue OVER the batch we just applied, and the
      // model/native queues diverge (ending in an out-of-range native skip).
      userActedRef.current = true;
      const q = queueRef.current;
      const extended = model.dedupeAppend(q, autoNextRef.current?.candidates);
      if (extended === q) {
        return;
      }
      const freshCount = extended.tracks.length - q.tracks.length;
      const jump = Math.min(Math.max(0, offset), freshCount - 1);
      const seeded = { ...extended, source: 'more like this' };
      // Appended rows start at the OLD queue length — same as idx + 1 when
      // the current track is last, but the batch now also shows with queued
      // picks sitting in between (see autoNextTracks).
      const target = { ...seeded, idx: q.tracks.length + jump };
      autoRadio.reset();
      applyQueue(target);
      setIsPlaying(true);
      enqueuePlayOp(async () => {
        // Append around the still-current seed, then hop onto the batch.
        // Anchor on where the native player ACTUALLY is, not the index this
        // closure captured: a retry runs after the rebuild already moved it
        // to the target, and re-anchoring on the old seed would skip audibly
        // back to it before jumping forward again.
        const active = await engine.getActiveIndex();
        const anchor =
          active != null && active < seeded.tracks.length ? active : q.idx;
        await engine.syncQueue(seeded, { startIndex: anchor });
        await engine.skipToIndex(target.idx);
        await engine.play();
      });
    },
    [applyQueue, enqueuePlayOp],
  );

  // Shared by the 'ended' path and a next-press on the last track. Appends
  // the prefetched continuation (source flips to 'more like this') and
  // advances; dead end on the ended path pauses with a toast, web-style.
  const runAutoRadio = useCallback(
    (seedQueue, { pauseOnFail }) => {
      autoRadio
        .extend(seedQueue)
        .then(extended => {
          const live = queueRef.current;
          // Stale if the queue moved on while the fetch was in flight.
          if (live.tracks !== seedQueue.tracks || live.idx !== seedQueue.idx) {
            return;
          }
          if (!extended) {
            if (pauseOnFail) {
              setIsPlaying(false);
              enqueueOp(() => engine.pause());
              showToast("couldn't find the next song.");
            } else {
              // A next-press already flipped isPlaying on — resume the current
              // (paused) track so state and audio agree, like web's play/pause
              // reconciliation effect does after a dead-end next.
              enqueueOp(() => engine.play());
            }
            return;
          }
          const advanced = { ...extended, idx: seedQueue.idx + 1 };
          applyQueue(advanced);
          setIsPlaying(true);
          enqueueOp(async () => {
            // Append around the still-current seed, then hop onto the batch.
            await engine.syncQueue(extended, { startIndex: seedQueue.idx });
            await engine.skipToIndex(advanced.idx);
            await engine.play();
          });
        })
        .catch(() => {});
    },
    [applyQueue, enqueueOp],
  );

  // ── service event handlers (registered once, read refs) ─────────────────
  const onQueueEnded = useCallback(() => {
    clearPosition();
    const q = queueRef.current;
    const d = model.decideNext(q, repeatRef.current);
    // End-of-set sleep fires at the exact moment the set would otherwise
    // wrap or fall through to auto-radio (web App.jsx:868) — preempting
    // both. The sleep-fire subscriber below does the pause + toast.
    if (d.action !== 'advance' && fireEndOfSetIfArmed()) {
      return;
    }
    if (d.action === 'advance' || d.action === 'wrap') {
      applyQueue({ ...q, idx: d.nextIdx });
      setIsPlaying(true);
      enqueuePlayOp(async () => {
        await engine.skipToIndex(d.nextIdx);
        await engine.play();
      });
    } else if (d.action === 'radio') {
      runAutoRadio(q, { pauseOnFail: true });
    } else {
      setIsPlaying(false);
      // ExoPlayer keeps playWhenReady=true at ENDED (and RNTP fires no
      // play-when-ready event) — lower it so a later queue edit's full
      // replace can't read it as "was playing" and auto-start the audio.
      enqueueOp(() => engine.pause());
    }
  }, [applyQueue, clearPosition, enqueueOp, enqueuePlayOp, runAutoRadio]);

  const onActiveTrackChanged = useCallback(
    e => {
      if (typeof e?.index !== 'number') {
        return;
      }
      const q = queueRef.current;
      if (e.index === q.idx || e.index < 0 || e.index >= q.tracks.length) {
        return;
      }
      // Native-initiated moves (gapless auto-advance, error auto-skip) flow
      // back into the model — but only when the ids line up, so a transient
      // event from a mid-rebuild queue can't corrupt idx.
      if (e.track?.id && q.tracks[e.index]?.id !== e.track.id) {
        return;
      }
      applyQueue({ ...q, idx: e.index });
    },
    [applyQueue],
  );

  const onPlayWhenReadyChanged = useCallback(
    e => {
      setIsPlaying(!!e?.playWhenReady);
      if (!e?.playWhenReady) {
        flushPosition();
      }
    },
    [flushPosition],
  );

  // ExoPlayer answers a PlaybackException by going idle but leaves
  // playWhenReady alone, so no play-when-ready event fires and the button kept
  // saying "playing" through the whole recovery walk (docs/perf/03) — up to
  // ~80s of silence with a frozen ribbon (field report). Playback state is the
  // only signal that moves. This COMPLEMENTS the playWhenReady mirror above:
  // intent still belongs to playWhenReady, this just stops it lying about the
  // audio.
  // Buffering / loading are deliberately left alone — they're the normal
  // mid-track rebuffer, and mirroring them would flicker the button every
  // time the network hiccups.
  const onPlaybackState = useCallback(e => {
    if (e?.state === 'playing') {
      setIsPlaying(true);
    } else if (e?.state === 'error' || e?.state === 'none') {
      setIsPlaying(false);
    }
  }, []);

  // ── user intents ─────────────────────────────────────────────────────────

  const playQueue = useCallback(
    (tracks, idx = 0, source = "tonight's set") => {
      userActedRef.current = true;
      const q = model.createQueue(tracks, idx, source);
      if (!q.tracks.length) {
        return;
      }
      applyQueue(q);
      setShuffleActive(false);
      preShuffleRef.current = null;
      setIsPlaying(true);
      enqueuePlayOp(async () => {
        await engine.syncQueue(q, { startIndex: q.idx });
        await engine.play();
      });
    },
    [applyQueue, enqueuePlayOp],
  );

  const playTrack = useCallback(
    (track, { source, queue: list } = {}) => {
      if (list?.length) {
        const at = list.findIndex(t => t.id === track.id);
        playQueue(list, Math.max(0, at), source ?? 'your pick');
      } else {
        playQueue([track], 0, source ?? 'your pick');
      }
    },
    [playQueue],
  );

  const togglePlay = useCallback(() => {
    userActedRef.current = true;
    if (isPlayingRef.current) {
      setIsPlaying(false);
      flushPosition();
      enqueueOp(() => engine.pause());
    } else {
      setIsPlaying(true);
      enqueuePlayOp(async () => {
        // After a system kill the model can remember a queue the NATIVE
        // player lost (the cold restore died before syncing) — play() on an
        // empty native queue no-ops with no error, which read as a dead play
        // button. Verify and rebuild first; then play always means play.
        const q = queueRef.current;
        if (q.tracks.length && (await engine.getQueueLength()) === 0) {
          // Rebuilding here stands in for the restore that never ran, so it
          // has to carry the same saved position — otherwise tapping play
          // before the restore lands silently resumes from 0:00.
          await engine.syncQueue(q, {
            startIndex: q.idx,
            positionSec: storedPositionSec(q),
          });
        }
        await engine.play();
      });
    }
  }, [enqueueOp, enqueuePlayOp, flushPosition]);

  const next = useCallback(() => {
    userActedRef.current = true;
    const q = queueRef.current;
    // A next-press always advances — repeat-one only affects natural ends.
    const r = repeatRef.current === 'one' ? 'off' : repeatRef.current;
    const d = model.decideNext(q, r);
    if (d.action === 'advance' || d.action === 'wrap') {
      applyQueue({ ...q, idx: d.nextIdx });
      setIsPlaying(true);
      enqueuePlayOp(async () => {
        await engine.skipToIndex(d.nextIdx);
        await engine.play();
      });
    } else if (d.action === 'radio') {
      setIsPlaying(true);
      runAutoRadio(q, { pauseOnFail: false });
    }
    // stop: a next-press with nowhere to go stays silent (web parity).
  }, [applyQueue, enqueuePlayOp, runAutoRadio]);

  const prev = useCallback(() => {
    userActedRef.current = true;
    const q = queueRef.current;
    if (!q.tracks.length) {
      return;
    }
    // Which track "previous" would step to, if we step at all.
    let idx = null;
    if (q.idx > 0) {
      idx = q.idx - 1;
    } else if (q.source === "tonight's set" || repeatRef.current === 'all') {
      idx = q.tracks.length - 1;
    }
    enqueuePlayOp(async () => {
      // Past the threshold — or with nothing to go back to — a previous press
      // RESTARTS the current track, keeping idx and the play/pause state as
      // they are. Only near the start does it step to the previous song (the
      // universal convention; the lock-screen control routes here too).
      const pos = await engine.getPosition();
      if (pos > engine.RESTART_THRESHOLD_SEC || idx == null) {
        await engine.seekTo(0);
        return;
      }
      applyQueue({ ...q, idx });
      setIsPlaying(true);
      await engine.skipToIndex(idx);
      await engine.play();
    });
  }, [applyQueue, enqueuePlayOp]);

  const seekTo = useCallback(
    sec => {
      enqueueOp(() => engine.seekTo(sec));
    },
    [enqueueOp],
  );

  // The live position, on demand — for flows that need "where am I right now"
  // once (share-this-moment), not a stream of progress events.
  const getPositionSec = useCallback(() => engine.getPosition(), []);

  const jumpTo = useCallback(
    i => {
      userActedRef.current = true;
      const q = queueRef.current;
      const nq = model.jumpTo(q, i);
      if (nq === q) {
        return;
      }
      applyQueue(nq);
      enqueuePlayOp(() => engine.skipToIndex(nq.idx));
    },
    [applyQueue, enqueuePlayOp],
  );

  const removeAt = useCallback(
    i => {
      userActedRef.current = true;
      applyAndSync(queueRef.current, base => model.removeAt(base, i));
    },
    [applyAndSync],
  );

  const reorder = useCallback(
    (from, to) => {
      userActedRef.current = true;
      applyAndSync(queueRef.current, base => model.reorder(base, from, to));
    },
    [applyAndSync],
  );

  // Web clearQueue (App.jsx): keep ONLY the currently playing track — the
  // queue becomes a fresh single-track 'your set' and the shuffle indicator
  // drops. The confirm lives with the caller; the engine sync rebuilds around
  // the unchanged current track, so playback is never interrupted.
  const clearQueue = useCallback(() => {
    userActedRef.current = true;
    // The gapless-boundary guard this used to carry alone now lives in
    // applyAndSync, where every sibling mutation gets it too.
    if (!applyAndSync(queueRef.current, base => model.clear(base))) {
      return;
    }
    setShuffleActive(false);
    preShuffleRef.current = null;
    showToast('queue cleared.');
  }, [applyAndSync]);

  // Context-menu "play next" / "add to queue" (web enqueueNext/enqueueLast).
  // First insertion flips "tonight's set" → 'your set' inside the model so
  // wrap-around turns off once the user starts curating. With nothing queued
  // they simply start playback.
  const enqueueNext = useCallback(
    track => {
      userActedRef.current = true;
      const q = queueRef.current;
      if (!q.tracks.length) {
        playTrack(track);
        return;
      }
      applyAndSync(q, base => model.addNext(base, track));
    },
    [applyAndSync, playTrack],
  );

  const enqueueLast = useCallback(
    track => {
      userActedRef.current = true;
      const q = queueRef.current;
      if (!q.tracks.length) {
        playTrack(track);
        return;
      }
      applyAndSync(q, base => model.addToEnd(base, track));
    },
    [applyAndSync, playTrack],
  );

  const cycleRepeat = useCallback(() => {
    const nextRepeat =
      repeatRef.current === 'off'
        ? 'all'
        : repeatRef.current === 'all'
        ? 'one'
        : 'off';
    repeatRef.current = nextRepeat;
    setRepeat(nextRepeat);
    storage.setItem(REPEAT_KEY, nextRepeat);
    enqueueOp(() => engine.setNativeRepeat(nextRepeat));
    // Entering a repeat mode makes the cached continuation unreachable.
    if (nextRepeat !== 'off') {
      autoRadio.reset();
    }
  }, [enqueueOp]);

  const toggleShuffle = useCallback(() => {
    if (shuffleActive) {
      // Off restores the pre-shuffle order — minus tracks removed since,
      // plus tracks added since — with the playing track kept playing.
      const original = preShuffleRef.current;
      preShuffleRef.current = null;
      setShuffleActive(false);
      if (
        applyAndSync(queueRef.current, base =>
          model.restoreOrder(base, original),
        )
      ) {
        showToast('back in order.');
      }
      return;
    }
    const q = queueRef.current;
    // shuffleUpcoming draws from an rng, and applyAndSync may run a mutation
    // twice — once for the optimistic paint, once from the corrected base if
    // the boundary guard fires. Seed it so both runs deal the same hand and
    // the list can never visibly re-roll under the user.
    const seed = Math.floor(Math.random() * 233280);
    const deal = () => {
      let n = seed;
      return () => {
        n = (n * 9301 + 49297) % 233280;
        return n / 233280;
      };
    };
    if (applyAndSync(q, base => model.shuffleUpcoming(base, deal()))) {
      preShuffleRef.current = q.tracks;
    }
    setShuffleActive(true);
    showToast('shuffled.');
  }, [applyAndSync, shuffleActive]);

  const setQuality = useCallback(
    id => {
      setAudioQuality(id);
      setQualityState(getAudioQuality());
      enqueueOp(() => engine.setQuality(id));
    },
    [enqueueOp],
  );

  // The volume-leveling mode (lib/leveling); the apply effect below reacts to
  // it, so switching modes re-levels the playing track immediately.
  const setLeveling = useCallback(id => {
    storeLeveling(id);
    setLevelingState(getLeveling());
  }, []);

  // Karaoke "music only": swap the active track to its cached instrumental
  // (url) or back to the full mix (null). Session-only by design — the flag
  // drops on every track change (effect below), so the next song always
  // starts with its voice.
  const musicOnlyRef = useRef(false);
  const setMusicOnly = useCallback(
    url => {
      musicOnlyRef.current = !!url;
      setMusicOnlyState(!!url);
      return enqueueOp(() => engine.setMusicOnly(url ?? null));
    },
    [enqueueOp],
  );

  const openPlayer = useCallback(() => setPlayerOpen(true), []);
  const closePlayer = useCallback(() => setPlayerOpen(false), []);
  // The queue rides ABOVE the player (its own overlay): opening it must not
  // close the player, and closing it lands back wherever you were.
  const openQueue = useCallback(() => setQueueOpen(true), []);
  const closeQueue = useCallback(() => setQueueOpen(false), []);
  // Lyrics sit between the player (30) and the queue (40) in the overlay
  // ladder; like the queue, opening them leaves the player where it was.
  const openLyrics = useCallback(() => setLyricsOpen(true), []);
  const closeLyrics = useCallback(() => setLyricsOpen(false), []);

  // Warm the lyrics cache for the settled track and its successor so opening
  // the overlay is instant (web App.jsx parity: 1.2s after the track settles;
  // the api module dedupes, so repeat fires are free).
  const currentId = queue.tracks[queue.idx]?.id;
  const nextId = queue.tracks[queue.idx + 1]?.id;
  useEffect(() => {
    if (!currentId) {
      return undefined;
    }
    const id = setTimeout(() => {
      prefetchLyrics(currentId);
      if (nextId) {
        prefetchLyrics(nextId);
      }
    }, 1200);
    return () => clearTimeout(id);
  }, [currentId, nextId]);

  // The notification heart mirrors the likes store: follow the current track
  // and every like/unlike, wherever it happens (an in-app heart, or the
  // notification heart itself via the service handler). `currentLiked` is
  // derived at render so the store's subscriber bump re-fires the effect;
  // engine.setLikeButton no-ops on repeats.
  const { isLiked } = useLikes();
  const currentLiked = currentId ? isLiked(currentId) : false;
  useEffect(() => {
    if (currentId) {
      engine.setLikeButton(currentLiked).catch(() => {});
    }
  }, [currentId, currentLiked]);

  // Volume leveling: set the player volume to the current track's measured
  // gain (lib/leveling; api/loudness caches, so repeat runs are free — the
  // next track's number rides the same batch fetch). An unmeasured track
  // plays as mastered while the server measures it; when that ~3s result
  // lands and the track is still playing, it levels mid-play. Mode changes
  // re-run this and re-level immediately.
  useEffect(() => {
    if (!currentId) {
      return undefined;
    }
    let stale = false;
    (async () => {
      const found = await getLoudness(
        nextId ? [currentId, nextId] : [currentId],
      );
      let info = found[currentId] ?? null;
      if (!info) {
        enqueueOp(() => engine.setVolume(1));
        info = await requestMeasure(currentId);
      }
      if (stale) {
        return;
      }
      enqueueOp(() => engine.setVolume(gainFor(leveling, info)));
    })();
    return () => {
      stale = true;
    };
  }, [currentId, nextId, leveling, enqueueOp]);

  // Music-only never follows across songs — when the playing track changes,
  // drop the flag and clear the engine override (which repairs the exact slot
  // the instrumental rode and leaves the new track untouched). Keyed on the
  // track id, NOT queue.idx: a benign queue edit that only shifts the current
  // song's index (removing an earlier track, reorder, un-shuffle) must not
  // yank the voice back mid-song. The rare move between two entries of the
  // SAME song leaves the flag briefly stale, but the engine's id+url guards
  // keep the audio and recovery correct until the next tap or karaoke exit.
  useEffect(() => {
    if (musicOnlyRef.current) {
      musicOnlyRef.current = false;
      setMusicOnlyState(false);
      enqueueOp(() => engine.setMusicOnly(null));
    }
  }, [currentId, enqueueOp]);

  // The engine clears music-only on its own when a broken instrumental forces
  // a fall back to the full mix — follow it so the pill matches the audio.
  useEffect(() => {
    engine.setAltClearedListener(() => {
      musicOnlyRef.current = false;
      setMusicOnlyState(false);
      showToast('back to the full song.');
    });
    return () => engine.setAltClearedListener(null);
  }, []);

  // ── boot: player setup, handler wiring, cold restore ─────────────────────
  useEffect(() => {
    let cancelled = false;
    let appStateSub = null;
    const stopRecorder = startRecorder(() => queueRef.current.source);
    registerHandlers({
      onRemoteNext: next,
      onRemotePrev: prev,
      onQueueEnded,
      onActiveTrackChanged,
      onPlaybackError: engine.handlePlaybackError,
      onPlayWhenReadyChanged,
      onPlaybackState,
      onProgress,
    });

    const boot = async () => {
      // Setup rides the op chain so every queued user action runs after it.
      let setupErr = null;
      await enqueueOp(async () => {
        try {
          await engine.setupPlayer();
        } catch (err) {
          setupErr = err;
        }
      });
      if (cancelled) {
        return;
      }
      mark('setup-player');
      if (setupErr) {
        if (setupErr.code === 'android_cannot_setup_player_in_background') {
          // Android refuses to create the player while the app is backgrounded
          // (cold start straight into background). Without a retry the whole
          // session would stay silently dead — boot again on next foreground.
          appStateSub = AppState.addEventListener('change', s => {
            if (s !== 'active' || cancelled) {
              return;
            }
            appStateSub?.remove();
            appStateSub = null;
            boot();
          });
        } else {
          console.warn('[player] setup failed', setupErr?.message ?? setupErr);
          // Not the backgrounded-boot case (that retries on foreground above)
          // — the player genuinely never came up, so this whole session is
          // silent. Nothing downstream can recover it.
          report(setupErr, 'player.setup-failed');
        }
        return;
      }
      enqueueOp(() => engine.setNativeRepeat(repeatRef.current));

      // Reattach: if the service kept playing while this JS process was dead
      // (swipe-away with ContinuePlayback), adopt its live intent — without
      // this the button boots showing "play" and the ribbon freezes while
      // audio runs on (no PlayWhenReadyChanged event fires on reattach; the
      // field report). syncQueue's rebuild-around-active path already keeps
      // the audio itself uninterrupted.
      engine
        .getPlayWhenReady()
        .then(pwr => {
          if (!cancelled && pwr) {
            setIsPlaying(true);
          }
        })
        .catch(() => {});

      // Cold restore: the persisted queue lost its stream URLs — refetch the
      // current + next, then mirror into the engine PAUSED, seeking back only
      // to a mid-track spot (0.01 < progress < 0.98).
      const q = queueRef.current;
      if (!q.tracks.length || userActedRef.current) {
        bootedRef.current = true;
        return;
      }
      const ids = [q.tracks[q.idx], q.tracks[q.idx + 1]]
        .filter(t => t && !t.streamUrl)
        .map(t => t.id);
      let restored = q;
      if (ids.length) {
        const fresh = await Promise.all(
          ids.map(id => getTrack(id).catch(() => null)),
        );
        if (cancelled || userActedRef.current) {
          bootedRef.current = true;
          return;
        }
        mark('restore-fetch');
        const byId = new Map(fresh.filter(Boolean).map(t => [t.id, t]));
        if (byId.size) {
          restored = {
            ...queueRef.current,
            tracks: queueRef.current.tracks.map(t =>
              byId.has(t.id) ? { ...t, ...byId.get(t.id) } : t,
            ),
          };
          applyQueue(restored);
        }
      }
      const positionSec = storedPositionSec(restored);
      enqueueOp(async () => {
        if (userActedRef.current) {
          return;
        }
        await engine.syncQueue(restored, {
          startIndex: restored.idx,
          positionSec,
        });
      }).then(() => {
        mark('restore-synced');
        bootedRef.current = true;
      });
    };
    boot();

    return () => {
      cancelled = true;
      appStateSub?.remove();
      stopRecorder();
      flushPosition();
    };
  }, [
    applyQueue,
    enqueueOp,
    flushPosition,
    next,
    onActiveTrackChanged,
    onPlaybackState,
    onPlayWhenReadyChanged,
    onProgress,
    onQueueEnded,
    prev,
  ]);

  // Screen-on resync: with the display off the service plays on and events
  // keep arriving, but the UI-side catch-up (queued events → renders → art)
  // can trail the audio by whole tracks and only settles seconds after wake
  // (field report: home banner stuck on the song from before screen-off).
  // One authoritative hop beats replaying the backlog — adopt the native
  // truth the moment the app is foregrounded, exactly like the boot reattach.
  // Riding the op chain orders the read after any in-flight user op, so a
  // just-tapped play/pause can't be clobbered by a pre-op snapshot.
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s !== 'active') {
        return;
      }
      enqueueOp(async () => {
        const [idx, active, pwr] = await Promise.all([
          engine.getActiveIndex(),
          engine.getActiveTrack(),
          engine.getPlayWhenReady(),
        ]);
        const q = queueRef.current;
        if (
          typeof idx === 'number' &&
          idx !== q.idx &&
          idx >= 0 &&
          idx < q.tracks.length &&
          active?.id &&
          q.tracks[idx]?.id === active.id
        ) {
          applyQueue({ ...q, idx });
        }
        setIsPlaying(!!pwr);
      });
    });
    return () => sub.remove();
  }, [applyQueue, enqueueOp]);

  // Notification permission, asked a beat into the FIRST real play — music is
  // audibly working, so the ask reads as "want to hear from us too?" instead
  // of a cold boot dialog. lib/push no-ops forever after one ask.
  useEffect(() => {
    if (!isPlaying) {
      return undefined;
    }
    const id = setTimeout(() => {
      ensurePushPermission().catch(() => {});
    }, 2500);
    return () => clearTimeout(id);
  }, [isPlaying]);

  // Sleep-timer expiry (duration or end-of-set) is a hard pause; the current
  // track position is retained (normal pause semantics, web parity).
  useEffect(
    () =>
      subscribeSleepFire(kind => {
        setIsPlaying(false);
        flushPosition();
        enqueueOp(() => engine.pause());
        showToast(
          kind === 'end-of-set' ? 'set ended · sleeping.' : 'sleep timer · paused.',
        );
      }),
    [enqueueOp, flushPosition],
  );

  // Sign-out tears playback down with it: the provider outlives the auth flip
  // (App only swaps the navigator for AuthScreen), so without this the music
  // would keep playing on the sign-in screen and the next sign-in would
  // inherit the previous session's queue. Storage was already wiped by
  // clearSession — this clears the live state and the native player.
  useEffect(
    () =>
      subscribeAuth(() => {
        if (isSignedIn()) {
          return;
        }
        userActedRef.current = true; // a cold restore in flight must abort
        setPlayerOpen(false);
        setQueueOpen(false);
        setLyricsOpen(false);
        setIsPlaying(false);
        setShuffleActive(false);
        preShuffleRef.current = null;
        autoRadio.reset();
        clearPosition();
        applyQueue(model.createQueue([], 0, "tonight's set"));
        enqueueOp(() => engine.syncQueue({ tracks: [] }));
      }),
    [applyQueue, clearPosition, enqueueOp],
  );

  // Persist the queue (streamUrl stripped) on every meaningful change; an
  // emptied queue removes the key so a sign-out reset can't resurrect it.
  const savePending = useRef(null);
  const saveTimer = useRef(null);
  const flushQueue = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const q = savePending.current;
    if (!q) {
      return;
    }
    savePending.current = null;
    if (q.tracks.length) {
      storage.setItem(
        QUEUE_KEY,
        JSON.stringify({ ...model.serializeQueue(q), v: QUEUE_VERSION }),
      );
    } else {
      storage.removeItem(QUEUE_KEY);
    }
  }, []);
  useEffect(() => {
    savePending.current = queue;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushQueue, 400);
    return () => clearTimeout(saveTimer.current);
  }, [queue, flushQueue]);
  // Teardown must not eat the last edit — the position path already flushes on
  // unmount (flushPosition), while this one discarded its pending write, so a
  // queue touched in the final 400ms of a session came back stale on the next
  // boot. flushQueue is stable, so this cleanup only ever runs at unmount.
  useEffect(() => flushQueue, [flushQueue]);

  // Dev-only drift readout: does RNTP still hold what MMKV persisted? Rides
  // the op chain so it runs AFTER any in-flight engine mutation rather than
  // mid-push (which would report drift that is really just a queue write still
  // travelling), and waits out the 400ms persist debounce first. __DEV__ is
  // stripped from release bundles, so this costs shipping users nothing.
  useEffect(() => {
    if (!__DEV__) {
      return undefined;
    }
    const t = setTimeout(() => {
      enqueueOp(() => dumpQueueDrift('post-change'));
    }, 500);
    return () => clearTimeout(t);
  }, [queue, enqueueOp]);

  // Prefetch the auto-radio continuation when the current track becomes the
  // last of a 'more like this' queue; hydrate stream URLs coming into play.
  useEffect(() => {
    autoRadio.noteQueueState(queue, repeat);
    if (bootedRef.current) {
      hydrateAround(queue);
    }
  }, [queue, repeat, hydrateAround]);

  const current = queue.tracks[queue.idx] ?? null;

  const ui = useMemo(
    () => ({
      playerOpen,
      openPlayer,
      closePlayer,
      queueOpen,
      openQueue,
      closeQueue,
      lyricsOpen,
      openLyrics,
      closeLyrics,
    }),
    [
      playerOpen,
      openPlayer,
      closePlayer,
      queueOpen,
      openQueue,
      closeQueue,
      lyricsOpen,
      openLyrics,
      closeLyrics,
    ],
  );

  const value = useMemo(
    () => ({
      current,
      queue,
      autoNext,
      autoNextTracks,
      playAutoNext,
      adoptAutoNext,
      insertTrackAt,
      isPlaying,
      repeat,
      shuffleActive,
      quality,
      ui,
      playTrack,
      playQueue,
      togglePlay,
      next,
      prev,
      seekTo,
      getPositionSec,
      jumpTo,
      removeAt,
      reorder,
      clearQueue,
      enqueueNext,
      enqueueLast,
      cycleRepeat,
      toggleShuffle,
      setQuality,
      leveling,
      setLeveling,
      musicOnly,
      setMusicOnly,
    }),
    [
      current,
      queue,
      autoNext,
      autoNextTracks,
      playAutoNext,
      adoptAutoNext,
      insertTrackAt,
      isPlaying,
      repeat,
      shuffleActive,
      quality,
      ui,
      playTrack,
      playQueue,
      togglePlay,
      next,
      prev,
      seekTo,
      getPositionSec,
      jumpTo,
      removeAt,
      reorder,
      clearQueue,
      enqueueNext,
      enqueueLast,
      cycleRepeat,
      toggleShuffle,
      setQuality,
      leveling,
      setLeveling,
      musicOnly,
      setMusicOnly,
    ],
  );

  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
}

export function usePlayer() {
  return useContext(PlayerContext);
}
