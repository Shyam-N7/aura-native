import { partOfDay } from '../utils/daypart';

// Ported from web src/lib/musicClock.js.
// The four parts of the day, in clock order. Keys match partOfDay()'s buckets
// (its single source of truth) so the copy stays consistent with the rest of
// the app; `night` covers both pre-dawn and late evening.
export const CLOCK_PARTS = [
  { key: 'morning', label: 'mornings' },
  { key: 'afternoon', label: 'afternoons' },
  { key: 'evening', label: 'evenings' },
  { key: 'night', label: 'late night' },
];

function bump(map, p) {
  const cur = map.get(p.trackId) ?? {
    trackId: p.trackId,
    title: p.title,
    artist: p.artist,
    imageUrl: p.imageUrl ?? null,
    count: 0,
  };
  cur.count += 1;
  map.set(p.trackId, cur);
}

function topN(map, n) {
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, n);
}

// Summarize raw plays ([{ trackId, title, artist, imageUrl, ts }]) into a
// time-of-day "music clock". PURE: each play's local hour comes from its own ts
// via new Date(ts), so it buckets in the VIEWER's timezone and is fully testable.
//   parts        — per-part play count + topTracks (most-played first)
//   afterMidnight— top track for local hours 0–4 (the "2am songs" signature), or null
//   busiest      — the part with the most plays (or null when there are none)
//   totalPlays   — plays counted across all parts
export function summarizeClock(plays = [], { perPart = 3 } = {}) {
  const parts = new Map(
    CLOCK_PARTS.map(p => [p.key, { ...p, plays: 0, byTrack: new Map() }]),
  );
  const amByTrack = new Map();

  for (const p of plays) {
    const d = new Date(p.ts);
    const bucket = parts.get(partOfDay(d));
    if (!bucket) {
      continue;
    }
    bucket.plays += 1;
    bump(bucket.byTrack, p);
    if (d.getHours() < 5) {
      bump(amByTrack, p);
    }
  }

  const partList = CLOCK_PARTS.map(({ key, label }) => {
    const b = parts.get(key);
    return { key, label, plays: b.plays, topTracks: topN(b.byTrack, perPart) };
  });
  const busiest = [...partList].sort((a, b) => b.plays - a.plays)[0];

  return {
    parts: partList,
    afterMidnight: topN(amByTrack, 1)[0] ?? null,
    busiest: busiest?.plays ? busiest : null,
    totalPlays: partList.reduce((s, p) => s + p.plays, 0),
  };
}
