import { fetchAuthed } from '../lib/auth';

// Volume-leveling data (see lib/leveling). All best-effort: a track without a
// measurement simply plays unleveled — nothing here may ever disrupt playback.

// trackId → { lufs, truePeak } (measured) or null (known-unmeasured), so a
// session never re-asks about the same track.
const cache = new Map();
// Measure requests already fired this session — one per track is plenty.
const requested = new Set();

export async function getLoudness(ids) {
  const need = ids.filter(id => id && !cache.has(id));
  if (need.length) {
    try {
      const res = await fetchAuthed(`/api/loudness?ids=${need.join(',')}`);
      if (res.ok) {
        const { tracks } = await res.json();
        for (const id of need) {
          cache.set(id, tracks?.[id] ?? null);
        }
      }
    } catch {
      /* best-effort */
    }
  }
  const out = {};
  for (const id of ids) {
    const v = cache.get(id);
    if (v) {
      out[id] = v;
    }
  }
  return out;
}

// Ask the server to measure an unmeasured track (a one-time ~3s ffmpeg pass
// server-side). Resolves with the measurement when the server did it inline —
// the caller can still level the CURRENT track mid-play — or null when it's
// busy/failed; either way the next listener finds it in the store.
export async function requestMeasure(trackId) {
  if (!trackId || requested.has(trackId)) {
    return null;
  }
  requested.add(trackId);
  try {
    const res = await fetchAuthed('/api/loudness/measure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId }),
    });
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    if (data?.status === 'done' && typeof data.lufs === 'number') {
      const info = { lufs: data.lufs, truePeak: data.truePeak ?? null };
      cache.set(trackId, info);
      return info;
    }
    return null;
  } catch {
    return null;
  }
}
