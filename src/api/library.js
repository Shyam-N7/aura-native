import { fetchAuthed } from '../lib/auth';
// Ported from web src/api/library.js.

export async function getLibrarySummary({ signal } = {}) {
  const res = await fetchAuthed('/api/library/summary', { signal });
  if (!res.ok) {
    throw new Error(`summary fetch failed (${res.status})`);
  }
  return res.json();
}
