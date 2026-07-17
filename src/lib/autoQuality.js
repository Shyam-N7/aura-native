// Adaptive bitrate for the 'auto' quality tier: pick the stream rung from how
// playback is ACTUALLY faring. The one truthful client-side signal RNTP
// exposes is buffer dynamics (seconds buffered ahead of the playhead), so the
// policy reads exactly that — no synthetic throughput guesses:
//   · buffer starving (< PANIC_SEC ahead) → step DOWN one tier, at most once
//     per STEP_COOLDOWN_MS
//   · buffer comfortably full (> HEALTHY_SEC ahead) for HEALTHY_HOLD_MS
//     straight → step UP one tier, back toward the source's 320 ceiling
//   · anything in between → hold
// On a network that sustains 160 but not 320 this can retry 320 once per
// healthy stretch and get knocked back down — accepted: the panic path swaps
// the current track to a lighter stream BEFORE the stall lands, so the retry
// costs a quality dip, not silence.
// Tiers are the catalog's real rungs; 48 exists only as the error-ladder
// floor, never a target. State is process-local — every session starts
// optimistic at 320 and adapts from evidence.

export const AUTO_TIERS = [320, 160, 96];

const PANIC_SEC = 4;
const HEALTHY_SEC = 25;
const HEALTHY_HOLD_MS = 30000;
const STEP_COOLDOWN_MS = 15000;

export function initialAutoState(now = 0) {
  return { tier: AUTO_TIERS[0], healthySince: null, lastStepAt: now };
}

// Pure policy step — returns the SAME state object when nothing changes so
// callers can compare by reference. Exported for tests.
export function decide(state, { bufferSec, now }) {
  const i = AUTO_TIERS.indexOf(state.tier);
  const canStep = now - state.lastStepAt >= STEP_COOLDOWN_MS;

  if (bufferSec < PANIC_SEC) {
    if (canStep && i < AUTO_TIERS.length - 1) {
      return { tier: AUTO_TIERS[i + 1], healthySince: null, lastStepAt: now };
    }
    return state.healthySince == null
      ? state
      : { ...state, healthySince: null };
  }

  if (bufferSec > HEALTHY_SEC) {
    if (state.healthySince == null) {
      return { ...state, healthySince: now };
    }
    if (canStep && i > 0 && now - state.healthySince >= HEALTHY_HOLD_MS) {
      return { tier: AUTO_TIERS[i - 1], healthySince: null, lastStepAt: now };
    }
    return state;
  }

  // Middle ground: neither starving nor provably comfortable — hold the tier
  // and drop any health streak (it must be continuous to earn a step up).
  return state.healthySince == null ? state : { ...state, healthySince: null };
}

let live = initialAutoState();

// The tier auto is currently streaming at (320 until evidence says otherwise).
export function autoTier() {
  return live.tier;
}

export function resetAuto(now = Date.now()) {
  live = initialAutoState(now);
}

// Feed one buffer sample. Returns how the tier moved ('down' | 'up' | null)
// so the engine can decide whether the CURRENT track needs the lighter stream
// right now (panic) or the change can wait for the next load.
export function noteAutoSample(bufferSec, now = Date.now()) {
  const prev = live;
  live = decide(live, { bufferSec, now });
  if (live.tier === prev.tier) {
    return null;
  }
  return live.tier < prev.tier ? 'down' : 'up';
}
