import { fetchAuthed } from '../lib/auth';

// The made-for-you mixes (on repeat, new to you, bring it back, morning/night) —
// read-only, generated server-side from the user's listening. Each carries its
// full prebuilt track list, so a tap can play the sequence directly without a
// detail-screen round trip. tzOffset keys the dated editions to the USER'S
// calendar day, not the server's. Ported from web src/api/autoPlaylists.js.
export async function listAutoPlaylists({ signal } = {}) {
  const res = await fetchAuthed(
    `/api/playlists/auto?tzOffset=${new Date().getTimezoneOffset()}`,
    { signal },
  );
  if (!res.ok) {
    throw new Error(`auto playlists failed (${res.status})`);
  }
  const { playlists } = await res.json();
  return playlists ?? [];
}
