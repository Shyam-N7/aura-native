// Ported from web src/utils/title.js (cleanLyric stays behind until lyrics
// arrive in a later phase).

// The catalog appends "(From "Movie Name")" to most soundtrack track titles.
// The song name on its own is what people recognize, so strip the suffix at
// the display layer. Original track.title in data stays untouched.
export function cleanTitle(title) {
  if (!title) {
    return title;
  }
  return title
    .replace(/\s*\(From\s+["“”'][^"“”']*["“”']\)\s*$/iu, '')
    .replace(/\s*\(From\s+[^)]*\)\s*$/iu, '')
    .trim();
}

// A dedup key for a track title: the cleaned name, lowercased. Used to
// collapse a song with its cover / alternate-credit recordings (same title,
// different artist). Mirrors the server's normalizeTitle in related.js.
export function titleKey(title) {
  return (cleanTitle(title) ?? '').toLowerCase();
}
