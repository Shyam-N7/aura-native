import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { isSignedIn } from '../lib/auth';
import { sendHeartbeat, getNowPlaying } from '../api/playback';

// Ported from web usePlaybackPresence: heartbeat this device's playback and
// poll for the user's other playing devices. Native differences: heartbeats
// keep running while the app is backgrounded (RNTP keeps JS alive and the
// music keeps playing — unlike a web tab, backgrounding is not stopping), and
// the poll pauses on background instead of document.hidden. There is no
// pagehide equivalent; a killed process just ages out of freshness (60s).
const HEARTBEAT_MS = 20_000;
const POLL_MS = 20_000;

export function usePlaybackPresence({ track, playing, progress }) {
  const [others, setOthers] = useState([]);
  // Refs keep the interval from re-binding on 1/s progress ticks.
  const stateRef = useRef({ track, playing, progress });
  stateRef.current = { track, playing, progress };
  // A cold-boot idle mount must never overwrite this device's real
  // last-playback row with a progress-0 'stopped' beat.
  const hasPlayed = useRef(false);

  useEffect(() => {
    if (!isSignedIn()) {
      return undefined;
    }
    const beat = () => {
      const s = stateRef.current;
      if (!s.track) {
        return;
      }
      sendHeartbeat({
        track: {
          id: s.track.id,
          title: s.track.title,
          artist: s.track.artist,
          imageUrl: s.track.imageUrl,
        },
        isPlaying: !!s.playing,
        progress: s.progress ?? 0,
      });
    };
    if (playing) {
      hasPlayed.current = true;
      beat();
      const id = setInterval(beat, HEARTBEAT_MS);
      return () => clearInterval(id);
    }
    if (hasPlayed.current) {
      beat(); // one 'stopped' beat on pause
    }
    return undefined;
  }, [track?.id, playing]);

  useEffect(() => {
    if (!isSignedIn()) {
      return undefined;
    }
    let alive = true;
    const tick = () => {
      if (AppState.currentState !== 'active') {
        return;
      }
      getNowPlaying().then(playingNow => {
        if (alive) {
          setOthers(playingNow);
        }
      });
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') {
        tick();
      }
    });
    return () => {
      alive = false;
      clearInterval(id);
      sub.remove();
    };
  }, []);

  return others;
}
