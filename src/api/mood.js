import { fetchAuthed } from '../lib/auth';
// Ported from web src/api/mood.js. The live mood snapshot:
// { mood, confidence, drift, reason, events_seen, id, ts } (mood null when
// the listening history is too thin to read).
export async function getCurrentMood({ refresh = false, signal } = {}) {
  const url = `/api/mood/current${refresh ? '?refresh=1' : ''}`;
  const res = await fetchAuthed(url, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `mood fetch failed (${res.status})`);
  }
  return res.json();
}
