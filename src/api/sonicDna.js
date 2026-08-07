import { fetchAuthed } from '../lib/auth';
import { apiError } from './apiError';
// Ported from web src/api/sonicDna.js. The listening fingerprint:
// { available, axes: [{label,v,range}], topMoods: [{label,count}],
//   thisMonth: {hours,artists,newTracks,returns}, signature, shift,
//   eventsSeen } — or { available:false, eventsSeen, threshold } when the
// 30-day window is too thin.
export async function getSonicDna({ signal } = {}) {
  const res = await fetchAuthed('/api/sonic-dna', { signal });
  if (!res.ok) {
    throw await apiError(res, 'your sonic dna');
  }
  return res.json();
}
