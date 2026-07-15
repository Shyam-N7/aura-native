import { fetchAuthed } from '../lib/auth';
// Ported from web src/api/bridges.js. URLSearchParams → hand-built query
// (RN's URLSearchParams is partial), per the blanket porting adaptations.

export async function getBridge({
  from,
  to,
  steps = 5,
  langs = [],
  signal,
} = {}) {
  let qs = `steps=${encodeURIComponent(steps)}`;
  if (langs?.length) {
    qs += `&langs=${encodeURIComponent(langs.join(','))}`;
  }
  const res = await fetchAuthed(
    `/api/bridges/${encodeURIComponent(from)}/${encodeURIComponent(to)}?${qs}`,
    { signal },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `bridge fetch failed (${res.status})`);
  }
  return res.json();
}

// The clairvoyant arrival: the server reads the latest mood snapshot +
// language affinity and proposes tonight's journey. Hour comes from the CLIENT
// clock — the server runs in UTC (same pattern as /api/greeting).
export async function getBridgeSuggestion({
  hour = new Date().getHours(),
  signal,
} = {}) {
  const res = await fetchAuthed(`/api/bridges/suggest?hour=${hour}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `bridge suggest failed (${res.status})`);
  }
  return res.json();
}
