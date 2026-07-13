import { useProgress } from 'react-native-track-player';

// The one read-only exception to "only engine.js talks to RNTP": the 4Hz
// position ticker the scrubber renders from.
export function usePlaybackProgress() {
  const { position, duration } = useProgress(250);
  return {
    position,
    duration,
    progress: duration > 0 ? Math.min(1, position / duration) : 0,
  };
}
