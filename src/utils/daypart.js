// Coarse time-of-day bucket, ported from web src/hooks/useNow.js partOfDay().
// Boundaries 5/12/17/21 mirror the server daypart (server/quickPicks.js);
// `night` covers both pre-dawn and late evening.
export function partOfDay(d = new Date()) {
  const h = d.getHours();
  if (h < 5) {
    return 'night';
  }
  if (h < 12) {
    return 'morning';
  }
  if (h < 17) {
    return 'afternoon';
  }
  return h < 21 ? 'evening' : 'night';
}

// 12-hour wall-clock label ("9:07 pm"), ported from web formatTime12.
export function formatTime12(d) {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) {
    h = 12;
  }
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}
