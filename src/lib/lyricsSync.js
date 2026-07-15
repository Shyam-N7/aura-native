// The synced-lyrics time math, ported verbatim from web LyricsScreen.jsx.
// Pure functions so the overlay stays declarative and this stays testable.

// During a long instrumental break the previously-active line should stop
// reading as "the current line" — we drop its active highlight so the screen
// settles into a neutral past-state instead of leaving a stale line glowing
// while no lyric is actually being sung. Trigger uses the later of
// GAP_AFTER_SEC (absolute floor) and 40% of the gap duration so the line gets
// its full vocal window before the gap mark surfaces.
export const MIN_GAP_SEC = 5; // total instrumental break must be at least this long
export const GAP_AFTER_SEC = 4; // absolute floor before treating the line as past

// Index of the last line whose timestamp has passed, or -1 before the first.
export function activeIndexFor(lines, seconds) {
  let last = -1;
  lines.forEach((l, i) => {
    if (l.t <= seconds) {
      last = i;
    }
  });
  return last;
}

// Three gap windows surface the "music is playing" mark:
// 1. Intro — before the first sung line, if the intro is long enough.
// 2. Between — instrumental break between two sung lines.
// 3. Outro — after the last sung line, until the track ends.
export function gapWindows(lines, seconds, durationSec, activeIdx) {
  const firstLine = lines[0];
  const lastLine = lines[lines.length - 1];
  const nextLine = lines[activeIdx + 1];
  const activeLine = activeIdx >= 0 ? lines[activeIdx] : null;

  const introGap = firstLine ? firstLine.t : 0;
  const inIntroGap = !!(
    activeIdx === -1 &&
    firstLine &&
    introGap >= MIN_GAP_SEC &&
    seconds > Math.max(GAP_AFTER_SEC, introGap * 0.4) &&
    seconds < firstLine.t
  );

  const betweenGap = activeLine && nextLine ? nextLine.t - activeLine.t : 0;
  const inBetweenGap = !!(
    activeLine &&
    nextLine &&
    betweenGap >= MIN_GAP_SEC &&
    seconds > activeLine.t + Math.max(GAP_AFTER_SEC, betweenGap * 0.4) &&
    seconds < nextLine.t
  );

  const outroGap = lastLine && durationSec ? durationSec - lastLine.t : 0;
  const inOutroGap = !!(
    activeIdx === lines.length - 1 &&
    lastLine &&
    outroGap >= MIN_GAP_SEC &&
    seconds > lastLine.t + Math.max(GAP_AFTER_SEC, outroGap * 0.4)
  );

  return { inIntroGap, inBetweenGap, inOutroGap };
}
