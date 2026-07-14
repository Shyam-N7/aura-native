import { fetchAuthed } from '../lib/auth';

// Quick picks — server-ranked home ring (anchored top 3 + daily-rotating rest),
// each pick carrying a plain-sentence `reason` and an `anchor` flag. tzOffset
// keys the daily rotation to the USER'S calendar day; `salt` is the "shuffle
// all" reroll (rotating slots re-pick, anchors stay). Ported from web
// src/api/quickPicks.js (query string built by hand — RN's URLSearchParams is
// only partially implemented).
export async function getQuickPicks({ salt, signal } = {}) {
  const params = [`tzOffset=${new Date().getTimezoneOffset()}`];
  if (salt) {
    params.push(`salt=${encodeURIComponent(String(salt))}`);
  }
  const res = await fetchAuthed(`/api/home/quick-picks?${params.join('&')}`, {
    signal,
  });
  if (!res.ok) {
    throw new Error(`quick picks failed (${res.status})`);
  }
  const { tracks } = await res.json();
  return tracks ?? [];
}
