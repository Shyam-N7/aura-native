import { fetchAuthed } from '../lib/auth';
import { apiError } from './apiError';
// Ported from web src/api/journal.js. Auto-written daily entries:
// { entries: [{ date, label, tracks, headline, body, tag }], totalEvents }.
// Note: entries[].tracks arrives as track-ID strings from the server — the
// journal screen hydrates them into track objects (the web renders them as
// objects and silently shows nothing; fixed here rather than replicated).
export async function getJournal({ days = 7, signal } = {}) {
  const res = await fetchAuthed(`/api/journal?days=${days}`, { signal });
  if (!res.ok) {
    throw await apiError(res, 'your journal');
  }
  return res.json();
}
