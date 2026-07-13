// Ported from web src/utils/fmtTime.js (fmtRuntime joins with the library
// screens in a later phase).
export function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
