import { fetchAuthed } from '../lib/auth';
// Ported from web src/api/journal.js. Auto-written daily entries:
// { entries: [{ date, label, tracks, headline, body, tag }], totalEvents }.
// Note: entries[].tracks arrives as track-ID strings from the server — the
// journal screen hydrates them into track objects (the web renders them as
// objects and silently shows nothing; fixed here rather than replicated).
export async function getJournal({ days = 7, signal } = {}) {
  const res = await fetchAuthed(`/api/journal?days=${days}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `journal fetch failed (${res.status})`);
  }
  return res.json();
}
