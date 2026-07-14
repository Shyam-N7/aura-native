import { fetchAuthed } from '../lib/auth';
// Presence API wrappers, ported from web src/lib/playback.js. All best-effort:
// every failure is swallowed so awareness never disrupts playback.

// The playing device reports its current track/state into its own session row.
export async function sendHeartbeat({ track, isPlaying, progress }) {
  try {
    await fetchAuthed('/api/playback/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ track, isPlaying, progress }),
    });
  } catch {
    /* best-effort */
  }
}

// Which of MY OTHER devices are currently playing (fresh heartbeat <60s).
export async function getNowPlaying() {
  try {
    const res = await fetchAuthed('/api/playback/now');
    if (!res.ok) {
      return [];
    }
    const { playing } = await res.json();
    return playing ?? [];
  } catch {
    return [];
  }
}

// Most recent real playback on the user's other devices (<24h, mid-track).
export async function getResume() {
  try {
    const res = await fetchAuthed('/api/playback/resume');
    if (!res.ok) {
      return null;
    }
    const { resume } = await res.json();
    return resume ?? null;
  } catch {
    return null;
  }
}
