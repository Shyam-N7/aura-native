// Ported from web src/utils/fmtTime.js.
export function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Human total-runtime for a whole list — "48 min", "1 hr", "5 hr 12 min".
// fmtTime's M:SS is wrong for long sums; this rounds to the nearest minute.
export function fmtRuntime(totalSec) {
  const min = Math.round(Math.max(0, totalSec) / 60);
  if (min < 60) {
    return `${min} min`;
  }
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}
