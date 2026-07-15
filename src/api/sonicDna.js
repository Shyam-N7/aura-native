import { fetchAuthed } from '../lib/auth';
// Ported from web src/api/sonicDna.js. The listening fingerprint:
// { available, axes: [{label,v,range}], topMoods: [{label,count}],
//   thisMonth: {hours,artists,newTracks,returns}, signature, shift,
//   eventsSeen } — or { available:false, eventsSeen, threshold } when the
// 30-day window is too thin.
export async function getSonicDna({ signal } = {}) {
  const res = await fetchAuthed('/api/sonic-dna', { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `sonic-dna fetch failed (${res.status})`);
  }
  return res.json();
}
