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
import { getAudioQuality, setAudioQuality } from '../lib/audioQuality';
import { getTrack } from '../api/catalog';
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
    return model.createQueue(
      parsed.tracks,
      Number.isFinite(parsed.idx) ? parsed.idx : 0,
      parsed.source || "tonight's set",
    );
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

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const [queue, setQueueState] = useState(
    () => loadStoredQueue() ?? model.createQueue([], 0, "tonight's set"),
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [repeat, setRepeat] = useState(readStoredRepeat);
  const [shuffleActive, setShuffleActive] = useState(false);
  const [quality, setQualityState] = useState(getAudioQuality);
  const [playerOpen, setPlayerOpen] = useState(false);

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
    });
    return opChain.current;
  }, []);

  const applyQueue = useCallback(nextQueue => {
    queueRef.current = nextQueue;
    setQueueState(nextQueue);
  }, []);

  // ── position persistence ({ trackId, progress } fraction, 5s debounce) ──
  const posPending = useRef(null);
  const posTimer = useRef(null);
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
    },
    [flushPosition],
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

  // ── auto-radio ───────────────────────────────────────────────────────────
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
    if (d.action === 'advance' || d.action === 'wrap') {
      applyQueue({ ...q, idx: d.nextIdx });
      setIsPlaying(true);
      enqueueOp(async () => {
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
  }, [applyQueue, clearPosition, enqueueOp, runAutoRadio]);

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

  // ── user intents ─────────────────────────────────────────────────────────
  // A user action during the cold restore window wins over the restore.
  const userActedRef = useRef(false);

  const playQueue = useCallback(
    (tracks, idx = 0, source = "tonight's set") => {
      userActedRef.current = true;
      const q = model.createQueue(tracks, idx, source);
      if (!q.tracks.length) {
        return;
      }
      applyQueue(q);
      setShuffleActive(false);
      setIsPlaying(true);
      enqueueOp(async () => {
        await engine.syncQueue(q, { startIndex: q.idx });
        await engine.play();
      });
    },
    [applyQueue, enqueueOp],
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
      enqueueOp(() => engine.play());
    }
  }, [enqueueOp, flushPosition]);

  const next = useCallback(() => {
    userActedRef.current = true;
    const q = queueRef.current;
    // A next-press always advances — repeat-one only affects natural ends.
    const r = repeatRef.current === 'one' ? 'off' : repeatRef.current;
    const d = model.decideNext(q, r);
    if (d.action === 'advance' || d.action === 'wrap') {
      applyQueue({ ...q, idx: d.nextIdx });
      setIsPlaying(true);
      enqueueOp(async () => {
        await engine.skipToIndex(d.nextIdx);
        await engine.play();
      });
    } else if (d.action === 'radio') {
      setIsPlaying(true);
      runAutoRadio(q, { pauseOnFail: false });
    }
    // stop: a next-press with nowhere to go stays silent (web parity).
  }, [applyQueue, enqueueOp, runAutoRadio]);

  const prev = useCallback(() => {
    userActedRef.current = true;
    const q = queueRef.current;
    if (!q.tracks.length) {
      return;
    }
    let idx = null;
    if (q.idx > 0) {
      idx = q.idx - 1;
    } else if (q.source === "tonight's set" || repeatRef.current === 'all') {
      idx = q.tracks.length - 1;
    }
    if (idx == null) {
      return;
    }
    applyQueue({ ...q, idx });
    setIsPlaying(true);
    enqueueOp(async () => {
      await engine.skipToIndex(idx);
      await engine.play();
    });
  }, [applyQueue, enqueueOp]);

  const seekTo = useCallback(
    sec => {
      enqueueOp(() => engine.seekTo(sec));
    },
    [enqueueOp],
  );

  const jumpTo = useCallback(
    i => {
      userActedRef.current = true;
      const q = queueRef.current;
      const nq = model.jumpTo(q, i);
      if (nq === q) {
        return;
      }
      applyQueue(nq);
      enqueueOp(() => engine.skipToIndex(nq.idx));
    },
    [applyQueue, enqueueOp],
  );

  const removeAt = useCallback(
    i => {
      userActedRef.current = true;
      const q = queueRef.current;
      const nq = model.removeAt(q, i);
      if (nq === q) {
        return;
      }
      applyQueue(nq);
      enqueueOp(() => engine.syncQueue(nq, { startIndex: nq.idx }));
    },
    [applyQueue, enqueueOp],
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
      // Off just clears the indicator — the order stays (web parity).
      setShuffleActive(false);
      return;
    }
    const q = queueRef.current;
    const nq = model.shuffleUpcoming(q);
    if (nq !== q) {
      applyQueue(nq);
      enqueueOp(() => engine.syncQueue(nq, { startIndex: nq.idx }));
    }
    setShuffleActive(true);
    showToast('shuffled.');
  }, [applyQueue, enqueueOp, shuffleActive]);

  const setQuality = useCallback(
    id => {
      setAudioQuality(id);
      setQualityState(getAudioQuality());
      enqueueOp(() => engine.setQuality(id));
    },
    [enqueueOp],
  );

  const openPlayer = useCallback(() => setPlayerOpen(true), []);
  const closePlayer = useCallback(() => setPlayerOpen(false), []);

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
        }
        return;
      }
      enqueueOp(() => engine.setNativeRepeat(repeatRef.current));

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
      let positionSec;
      const saved = readStoredPosition();
      const cur = restored.tracks[restored.idx];
      if (
        saved &&
        cur &&
        saved.trackId === cur.id &&
        saved.progress > 0.01 &&
        saved.progress < 0.98 &&
        cur.durationSec > 0
      ) {
        positionSec = saved.progress * cur.durationSec;
      }
      enqueueOp(async () => {
        if (userActedRef.current) {
          return;
        }
        await engine.syncQueue(restored, {
          startIndex: restored.idx,
          positionSec,
        });
      }).then(() => {
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
    onPlayWhenReadyChanged,
    onProgress,
    onQueueEnded,
    prev,
  ]);

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
        setIsPlaying(false);
        setShuffleActive(false);
        autoRadio.reset();
        clearPosition();
        applyQueue(model.createQueue([], 0, "tonight's set"));
        enqueueOp(() => engine.syncQueue({ tracks: [] }));
      }),
    [applyQueue, clearPosition, enqueueOp],
  );

  // Persist the queue (streamUrl stripped) on every meaningful change; an
  // emptied queue removes the key so a sign-out reset can't resurrect it.
  const saveTimer = useRef(null);
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (queue.tracks.length) {
        storage.setItem(QUEUE_KEY, JSON.stringify(model.serializeQueue(queue)));
      } else {
        storage.removeItem(QUEUE_KEY);
      }
    }, 400);
    return () => clearTimeout(saveTimer.current);
  }, [queue]);

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
    () => ({ playerOpen, openPlayer, closePlayer }),
    [playerOpen, openPlayer, closePlayer],
  );

  const value = useMemo(
    () => ({
      current,
      queue,
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
      jumpTo,
      removeAt,
      cycleRepeat,
      toggleShuffle,
      setQuality,
    }),
    [
      current,
      queue,
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
      jumpTo,
      removeAt,
      cycleRepeat,
      toggleShuffle,
      setQuality,
    ],
  );

  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
}

export function usePlayer() {
  return useContext(PlayerContext);
}
