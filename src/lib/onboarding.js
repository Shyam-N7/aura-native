import { storage } from '../storage/mmkv';
import { updatePreferences } from './auth';
// Ported from web src/lib/onboarding.js. Four MMKV keys mirror the web's
// localStorage ones (persistUser also mirrors them from the server user):
//   aura.hasOnboarded   — '1' once the pick-3 flow finishes.
//   aura.seedArtists    — JSON [{ name, language?, sampleTrackId? }].
//   aura.seedLanguages  — JSON [languageString].
//   aura.seedMood       — mood label string, or absent.

const SEEDS_KEY = 'aura.seedArtists';
const LANGS_KEY = 'aura.seedLanguages';
const MOOD_KEY = 'aura.seedMood';

export function markOnboarded() {
  // Push the snapshot to the server so a returning user (new device, cleared
  // storage) keeps their seeds. Fire-and-forget — onboarding never blocks on
  // the network, and the local copy is the source of truth meanwhile.
  const { languages, mood } = getSeedSignals();
  updatePreferences({
    hasOnboarded: true,
    seedArtists: getSeedArtists(),
    seedLanguages: languages,
    seedMood: mood,
  }).catch(() => {
    // offline / unauthenticated — the persisted flag still holds locally
  });
  // Optimistic local flag so the gate advances even before the PATCH lands.
  storage.setItem('aura.hasOnboarded', '1');
}

export function getSeedArtists() {
  try {
    const raw = storage.getItem(SEEDS_KEY);
    if (!raw) {
      return [];
    }
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function setSeedArtists(arr) {
  try {
    storage.setItem(SEEDS_KEY, JSON.stringify(arr ?? []));
  } catch {
    // ignore
  }
}

export function getSeedSignals() {
  try {
    const langsRaw = storage.getItem(LANGS_KEY);
    const langs = langsRaw ? JSON.parse(langsRaw) : [];
    const mood = storage.getItem(MOOD_KEY);
    return {
      languages: Array.isArray(langs) ? langs : [],
      mood: mood && mood.length ? mood : null,
    };
  } catch {
    return { languages: [], mood: null };
  }
}

export function setSeedSignals({ languages, mood } = {}) {
  try {
    storage.setItem(
      LANGS_KEY,
      JSON.stringify(Array.isArray(languages) ? languages : []),
    );
    if (mood) {
      storage.setItem(MOOD_KEY, String(mood));
    } else {
      storage.removeItem(MOOD_KEY);
    }
  } catch {
    // ignore
  }
}
