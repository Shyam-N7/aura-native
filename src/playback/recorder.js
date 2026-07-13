import TrackPlayer, { Event, State } from 'react-native-track-player';
import { recordEvent } from '../api/events';
import { getUser } from '../lib/auth';

// Listening events wired to RNTP, replicating the semantics of web
// src/hooks/useListeningRecorder.js:
//   'play'  once per track, at its first transition to playing
//   'pause' on pause, only if that track has already played — AND right before
//           every natural 'end' (the web audio element fires pause→ended at
//           end-of-media, so web writes a pause+end pair per natural end)
//   'end'   at a track's natural end, with position_sec = duration
//   'skip'  when the active track changes away from one that played mid-way
//           (web posts skip with no position — keep position_sec null)
//   no seek events (would be high-frequency).
//
// RNTP wrinkle vs the web audio element: a gapless auto-advance keeps the
// state at 'playing' (no new play event), so the track-change handler arms
// AND posts 'play' for the incoming track when playback is already rolling.

// ExoPlayer reports lastPosition slightly short of duration at a natural end.
const NATURAL_END_GRACE_SEC = 1.5;

// Web sends the design-harness mood tweak with every event — a constant
// 'calm' in production (users can't change it) — so both clients write the
// same value into the shared events table.
const WEB_TWEAK_MOOD = 'calm';

export function startRecorder(getSource) {
  let current = null; // active RNTP track — carries id/language/duration
  let playedOnce = false;

  const base = track => ({
    track_id: track.id,
    mood: WEB_TWEAK_MOOD,
    language: track.language ?? null,
    // The account's active mode rides every event (web App.jsx activeMode).
    mode: getUser()?.activeMode ?? 'everyday',
    source: getSource() ?? null,
  });

  const endedNaturally = (track, positionSec) => {
    const dur = track?.duration;
    return dur > 0 && positionSec >= dur - NATURAL_END_GRACE_SEC;
  };

  // Web writes 'pause' (position ≈ duration) then 'end' at every natural end —
  // the HTML element fires pause before ended. Mirror the pair.
  const postNaturalEnd = track => {
    recordEvent({
      ...base(track),
      kind: 'pause',
      position_sec: track.duration ?? 0,
    });
    recordEvent({
      ...base(track),
      kind: 'end',
      position_sec: track.duration ?? null,
    });
    playedOnce = false;
  };

  const postPlayIfRolling = async track => {
    const { state } = await TrackPlayer.getPlaybackState().catch(() => ({}));
    if (state !== State.Playing) {
      return;
    }
    playedOnce = true;
    recordEvent({ ...base(track), kind: 'play', position_sec: 0 });
  };

  const subs = [
    TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, async e => {
      const last = e.lastTrack ?? null;
      const nextTrack = e.track ?? null;

      if (last && nextTrack && last.id === nextTrack.id) {
        // Same track re-armed: a queue rebuild/hydration reload is a no-op,
        // but a repeat-one loop (position reached the end) is a real 'end' —
        // and the loop keeps playing with no state change, so re-arm + post
        // 'play' here or loops 2+ would record nothing (web posts a fresh
        // play+end pair per pass).
        if (playedOnce && endedNaturally(last, e.lastPosition)) {
          postNaturalEnd(last);
          current = nextTrack;
          await postPlayIfRolling(nextTrack);
          return;
        }
        current = nextTrack;
        return;
      }

      if (last && playedOnce) {
        if (endedNaturally(last, e.lastPosition)) {
          postNaturalEnd(last);
        } else {
          recordEvent({ ...base(last), kind: 'skip', position_sec: null });
        }
      }
      current = nextTrack;
      playedOnce = false;
      if (nextTrack) {
        await postPlayIfRolling(nextTrack);
      }
    }),

    TrackPlayer.addEventListener(Event.PlaybackState, async e => {
      if (e.state === State.Playing) {
        if (!current) {
          current = (await TrackPlayer.getActiveTrack()) ?? null;
        }
        if (!current || playedOnce) {
          return;
        }
        playedOnce = true;
        const { position } = await TrackPlayer.getProgress().catch(() => ({
          position: 0,
        }));
        recordEvent({
          ...base(current),
          kind: 'play',
          position_sec: position ?? 0,
        });
      } else if (e.state === State.Paused) {
        if (!current || !playedOnce) {
          return;
        }
        const { position } = await TrackPlayer.getProgress().catch(() => ({
          position: 0,
        }));
        recordEvent({
          ...base(current),
          kind: 'pause',
          position_sec: position ?? 0,
        });
      }
    }),

    // The very last track of the queue ends with no track change — this is
    // its natural 'end'. playedOnce drops so the paused state that follows
    // (or a wrap re-arming the same track) can't double-post.
    TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
      if (!current || !playedOnce) {
        return;
      }
      postNaturalEnd(current);
    }),
  ];

  return () => subs.forEach(s => s.remove());
}
