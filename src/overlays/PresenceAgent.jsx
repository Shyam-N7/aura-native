import { useEffect, useRef, useState } from 'react';
import { usePlayer } from '../playback/PlayerContext';
import { usePlaybackProgress } from '../hooks/usePlaybackProgress';
import { usePlaybackPresence } from '../hooks/usePlaybackPresence';
import { getResume } from '../api/playback';
import { getTrack } from '../api/catalog';
import { storage } from '../storage/mmkv';
import { K } from '../storage/keys';
import { setPresenceFeed } from '../lib/presenceFeed';

// Multi-device awareness, ported from web App.jsx + NowPlayingElsewhere —
// formerly PresenceBanners, which floated its own pills over the chrome. The
// owner's call ("feels disturbing") retired the pills: this agent is HEADLESS,
// keeping the heartbeat/poll alive app-wide regardless of which tab is up,
// and publishing to lib/presenceFeed for the home now-playing card to wear.
// No takeover, no remote control; the boot resume offer stays one-shot.

function readSavedTrackId() {
  try {
    const raw = storage.getItem(K.position);
    return raw ? JSON.parse(raw)?.trackId ?? null : null;
  } catch {
    return null;
  }
}

export function PresenceAgent() {
  const player = usePlayer();
  // Slow ticker — presence only needs a fraction per 20s beat.
  const { progress } = usePlaybackProgress(5000);
  const others = usePlaybackPresence({
    track: player.current,
    playing: player.isPlaying,
    progress,
  });

  const [resume, setResume] = useState(null);
  const bootTrackId = useRef(player.current?.id);

  useEffect(() => {
    getResume().then(r => {
      if (!r?.track?.id) {
        return;
      }
      // Offer only mid-track playback that isn't already where we are.
      if (r.progress <= 0.02 || r.progress >= 0.98) {
        return;
      }
      if (
        r.track.id === readSavedTrackId() ||
        r.track.id === bootTrackId.current
      ) {
        return;
      }
      setResume(r);
    });
  }, []);

  useEffect(() => {
    const acceptResume = async () => {
      const r = resume;
      setResume(null);
      // Refetch for a fresh streamUrl + durationSec; the resume row carries
      // only display fields.
      const fresh = await getTrack(r.track.id).catch(() => null);
      const track = fresh ?? r.track;
      player.playTrack(track, { source: 'your pick' });
      if (track.durationSec) {
        // Rides the op chain, so it lands after the load + play.
        player.seekTo(r.progress * track.durationSec);
      }
      player.ui?.openPlayer?.();
    };
    setPresenceFeed({
      elsewhere: others[0] ?? null,
      resume,
      acceptResume: resume ? acceptResume : null,
      dismissResume: resume ? () => setResume(null) : null,
    });
  }, [others, resume, player]);

  useEffect(
    () => () =>
      setPresenceFeed({
        elsewhere: null,
        resume: null,
        acceptResume: null,
        dismissResume: null,
      }),
    [],
  );

  return null;
}
