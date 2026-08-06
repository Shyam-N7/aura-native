import { storage } from '../storage/mmkv';
import { K } from '../storage/keys';
import { updatePreferences } from './auth';
import { markWhatsNewSeenForNewInstall } from './whatsNew';
// Ported from web src/lib/onboarding.js. Three MMKV keys mirror the web's
// localStorage ones (persistUser also mirrors them from the server user):
//   aura.seedArtists    — JSON [{ name, language?, sampleTrackId? }].
//   aura.seedLanguages  — JSON [languageString].
//   aura.seedMood       — mood label string, or absent.
// The onboarded flag is NOT among them: that state lives on the server user
// (auth.hasOnboarded reads getUser()?.hasOnboarded), which is the only thing
// the gate consults.

const SEEDS_KEY = K.seedArtists;
const LANGS_KEY = K.seedLanguages;
const MOOD_KEY = K.seedMood;

export function markOnboarded() {
  // A first-time user has no update to be told about. Without this the
  // what's-new sheet auto-opened the moment onboarding handed over, and then
  // the gesture tour taught the same two gestures again.
  markWhatsNewSeenForNewInstall();
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
    // Offline / unauthenticated. Nothing local to fall back on: the gate reads
    // the server-confirmed user, so a failed PATCH means this run of onboarding
    // is not recorded and a later COLD START will ask again. Mid-session is
    // unaffected — App's finishOnboarding advances the flow directly.
    //
    // There used to be a `storage.setItem('aura.hasOnboarded', '1')` here,
    // described as an optimistic flag that advanced the gate before the PATCH
    // landed. It never did: hasOnboarded() reads aura.authUser, so that key was
    // written, mirrored, cleared on sign-out — and read by nothing, ever.
    // Removed rather than wired up, because honouring a local flag would let a
    // stale one skip onboarding for a brand-new account on the same device.
    // Closing the re-ask window properly needs a separate pending key plus a
    // retry on boot; recorded in reports/11-onboarding-audit.md as follow-up.
  });
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
