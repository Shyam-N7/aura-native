import { useProgress } from 'react-native-track-player';

// The one read-only exception to "only engine.js talks to RNTP": the position
// ticker. Default 4Hz for the scrubber; slower consumers (presence heartbeats)
// pass their own interval.
export function usePlaybackProgress(intervalMs = 250) {
  const { position, duration } = useProgress(intervalMs);
  return {
    position,
    duration,
    progress: duration > 0 ? Math.min(1, position / duration) : 0,
  };
}
