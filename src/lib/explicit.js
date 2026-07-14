// Drop explicit-flagged tracks when Family mode is on. Tracks without the flag
// (e.g. older cached items, or rows served straight from the DB) are kept — the
// `explicit` flag only rides discovery responses (mapSong / mapRecoSong), which
// is where new explicit content would be found. The PIN gate (server) is the
// real boundary; this is the UX filter. Ported from web src/lib/explicit.js.
export function dropExplicit(list, on) {
  if (!on || !Array.isArray(list)) {
    return list ?? [];
  }
  return list.filter(t => !t?.explicit);
}
