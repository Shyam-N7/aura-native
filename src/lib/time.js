// Compact "time ago" formatter — device "last active" labels, playlist
// "updated X ago", etc. Takes a unix-ms timestamp (Number or numeric string
// from pg); returns '' for missing/invalid. `now` is injectable for tests.
// Verbatim port of web src/lib/time.js.
export function relTime(ms, now = Date.now()) {
  const t = Number(ms);
  if (!Number.isFinite(t) || t <= 0) {
    return '';
  }
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 45) {
    return 'just now';
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m ago`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    return `${h}h ago`;
  }
  const d = Math.floor(h / 24);
  if (d < 7) {
    return `${d}d ago`;
  }
  const w = Math.floor(d / 7);
  if (w < 5) {
    return `${w}w ago`;
  }
  return new Date(t)
    .toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    .toLowerCase();
}
