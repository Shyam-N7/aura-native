import { fetchAuthed } from '../lib/auth';
// Ported from web src/api/talk.js. One turn of the DJ conversation:
// { message, history: [{who,text}], context: { mood } } →
// { reply, action: {kind,query,language,count}, tracks, suggestions }.
export async function talk({ message, history, context, signal } = {}) {
  const res = await fetchAuthed('/api/llm/talk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history, context }),
    signal,
    // Gemini legitimately thinks past fetchAuthed's 15s default on a slow
    // network; the DJ turn gets a wider budget rather than a false timeout.
    deadlineMs: 45000,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `talk failed (${res.status})`);
  }
  return res.json();
}
