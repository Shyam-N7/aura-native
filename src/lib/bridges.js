import { storage } from '../storage/mmkv';
// Ported from web bridgeCfg.js + BridgeCard MOOD_COLOR + data/moodBridges.js.
// Two plain word sets, each mapping to a server MOOD_QUERIES bucket: "where you
// are" (a current feeling) and "where you want to be" (the goal). Colours tint
// the selected chip and the bridge arc.

export const FROM_MOODS = [
  { key: 'sad', hint: 'low, heavy', color: '#5a6b9a' },
  { key: 'stressed', hint: 'wound up', color: '#a85a5a' },
  { key: 'restless', hint: 'antsy, wired', color: '#c2603a' },
  { key: 'tired', hint: 'drained', color: '#7a6f8a' },
  { key: 'lonely', hint: 'on your own', color: '#5a7a8a' },
];
export const TO_MOODS = [
  { key: 'happy', hint: 'lifted', color: '#d8956a' },
  { key: 'calm', hint: 'at ease', color: '#5a8a72' },
  { key: 'focused', hint: 'locked in', color: '#6e85a3' },
  { key: 'energized', hint: 'fired up', color: '#c47554' },
  { key: 'social', hint: 'out, lively', color: '#a8556a' },
];

export const MOOD_COLOR = Object.fromEntries(
  [...FROM_MOODS, ...TO_MOODS].map(m => [m.key, m.color]),
);

// Only the five languages the bridges server actually threads on (its
// ALL_LANGS whitelist). The web chip row shows all catalog languages but the
// server silently drops the rest — showing only the honored five keeps the
// choice honest (no chip that quietly does nothing).
export const BRIDGE_LANGS = ['tamil', 'english', 'hindi', 'malayalam', 'kannada'];
export const MIN_STEPS = 4;
export const MAX_STEPS = 8;

// The four classic preset paths (web data/moodBridges.js).
export const MOOD_BRIDGES = [
  { id: 'br1', from: 'sad', to: 'happy', steps: 5, eta: '18 min' },
  { id: 'br2', from: 'stressed', to: 'calm', steps: 6, eta: '24 min' },
  { id: 'br3', from: 'tired', to: 'energized', steps: 4, eta: '15 min' },
  { id: 'br4', from: 'restless', to: 'focused', steps: 4, eta: '13 min' },
];

const FROM_KEYS = FROM_MOODS.map(m => m.key);
const TO_KEYS = TO_MOODS.map(m => m.key);
const KEY = 'aura.moodBridge';

// The last configured bridge persists per-device like the other aura.* prefs.
// Saved keys are validated against the CURRENT vocabulary — a cfg saved before
// the mood words changed would otherwise send an invalid mood and 400. `langs:
// []` means "your mix" (the server resolves it from listening affinity).
export function loadCfg() {
  try {
    const c = JSON.parse(storage.getItem(KEY));
    if (c && c.steps && FROM_KEYS.includes(c.from) && TO_KEYS.includes(c.to)) {
      const langs = Array.isArray(c.langs)
        ? c.langs.filter(l => BRIDGE_LANGS.includes(l)).slice(0, 2)
        : [];
      const steps = Math.min(MAX_STEPS, Math.max(MIN_STEPS, Number(c.steps) || 5));
      return { from: c.from, to: c.to, steps, langs };
    }
  } catch {
    // ignore
  }
  return { from: 'sad', to: 'happy', steps: 5, langs: [] };
}

export function saveCfg(cfg) {
  try {
    storage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    // storage disabled — non-fatal
  }
}

// sRGB blend between two hex colours — the native stand-in for the web's
// color-mix(in oklab, …) on the arc's midpoint dots.
function channels(hex) {
  const h = hex.slice(1);
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
export function blendHex(a, b, t) {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}
