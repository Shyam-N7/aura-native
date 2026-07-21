import { useRef } from 'react';

// Which way is the music travelling? +1 forward (the filmstrip flows left),
// -1 backward, 0 when there's no honest answer. Derived from the queue model,
// not from which button was pressed, so every path that moves the needle —
// next/prev, auto-advance, a queue-row tap — reads the same: an idx step
// inside the SAME tracks array is real travel, and an append-extended array
// (auto-radio's continuation) counts as the same strip via identity
// spot-checks on the shared prefix's ends. A genuinely new set has no
// direction; a wrap across the ends is travel in the wrapping direction.
export function useTrackDirection(queue) {
  const prev = useRef({ tracks: null, idx: -1 });
  const dir = useRef(0);
  const tracks = queue?.tracks ?? null;
  const idx = queue?.idx ?? -1;
  const was = prev.current;
  if (tracks !== was.tracks) {
    const extended =
      !!tracks &&
      !!was.tracks &&
      was.tracks.length > 0 &&
      tracks.length > was.tracks.length &&
      tracks[0] === was.tracks[0] &&
      tracks[was.tracks.length - 1] === was.tracks[was.tracks.length - 1];
    dir.current = extended ? Math.sign(idx - was.idx) : 0;
    prev.current = { tracks, idx };
  } else if (tracks && idx !== was.idx) {
    const last = tracks.length - 1;
    if (was.idx === last && idx === 0) {
      dir.current = 1;
    } else if (was.idx === 0 && idx === last) {
      dir.current = -1;
    } else {
      dir.current = Math.sign(idx - was.idx);
    }
    prev.current = { tracks, idx };
  }
  return dir.current;
}
