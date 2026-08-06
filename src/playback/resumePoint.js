// Where a restored queue should start playing.
//
// This lived twice, in the same five conditions written in a different order:
// PlayerContext decided where playback actually resumes, usePlaybackProgress
// decided what the scrubber shows before the engine has a queue. They agreed
// by coincidence, and docs/CONTEXT.md called that out as a landmine — the two
// are only ever read together, so any divergence shows up as the display
// promising a resume that playback then ignores (or the reverse), with
// nothing failing anywhere.
//
// The window is deliberate: a track that barely started is not worth resuming,
// and one that is nearly over is better restarted than resumed two seconds
// from the outro.
const MIN_PROGRESS = 0.01;
const MAX_PROGRESS = 0.98;

/**
 * @param saved  the parsed K.position snapshot: { trackId, progress }
 * @param track  the queue row it would apply to: { id, durationSec }
 * @returns seconds to resume at, or null when the snapshot does not apply
 */
export function resumeSec(saved, track) {
  if (!saved || !track) {
    return null;
  }
  // A snapshot for a different track is stale, not a resume point — the queue
  // moved on without the position being rewritten.
  if (saved.trackId !== track.id) {
    return null;
  }
  if (!(track.durationSec > 0)) {
    return null;
  }
  if (!(saved.progress > MIN_PROGRESS && saved.progress < MAX_PROGRESS)) {
    return null;
  }
  return saved.progress * track.durationSec;
}
