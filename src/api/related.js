import { fetchAuthed, getActiveExplicitOff, getUser } from '../lib/auth';

export async function getRelated(
  trackId,
  { lang, limit = 15, mode, signal } = {},
) {
  const params = [];
  if (lang) {
    params.push(`lang=${encodeURIComponent(lang)}`);
  }
  if (limit) {
    params.push(`limit=${limit}`);
  }
  // Tell the server the active mode so Car Mode can bias the auto-radio away
  // from songs the user skips (the server only acts on 'car'). Callers may
  // override; default is the signed-in user's active mode, like the web.
  const activeMode = mode ?? getUser()?.activeMode;
  if (activeMode) {
    params.push(`mode=${encodeURIComponent(activeMode)}`);
  }
  const query = params.length ? `?${params.join('&')}` : '';
  const res = await fetchAuthed(
    `/api/tracks/${encodeURIComponent(trackId)}/related${query}`,
    { signal },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `related failed (${res.status})`);
  }
  const data = await res.json();
  // The active mode's explicit policy hides explicit songs from discovery.
  // The related endpoint feeds BOTH the auto-radio (queue fill) and the "more
  // like this" rails, so filtering here is the single chokepoint for every
  // consumer (web routes this through lib/explicit — inlined here, Phase 1's
  // only call site).
  const tracks = data.tracks ?? [];
  return getActiveExplicitOff() ? tracks.filter(t => !t?.explicit) : tracks;
}
