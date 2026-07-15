// Canonical language list — ported from web src/data/languages.js. PRIMARY are
// shown up front; MORE sit behind a "more languages" expander in onboarding.
export const PRIMARY_LANGUAGES = [
  'tamil',
  'english',
  'hindi',
  'malayalam',
  'kannada',
  'telugu',
];
export const MORE_LANGUAGES = [
  'bengali',
  'marathi',
  'punjabi',
  'gujarati',
  'urdu',
  'bhojpuri',
  'odia',
  'assamese',
];
export const LANGUAGES = [...PRIMARY_LANGUAGES, ...MORE_LANGUAGES];
