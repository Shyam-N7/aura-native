import {
  AppState,
  NativeEventEmitter,
  NativeModules,
  TurboModuleRegistry,
} from 'react-native';
import { storage } from '../storage/mmkv';
import { crumb } from './crumbs';

// The equalizer's JS half — house singleton (get / set / subscribe, MMKV
// persisted), same shape as lib/audioQuality.js and lib/leveling.js.
//
// Two things make this different from the web equalizer it's ported from:
//
//  1. The DEVICE owns the bands. Android's system equalizer decides how many
//     there are and where they sit (this phone: 5, at 60/230/910/3.6k/14k,
//     ±15 dB) — so the web's fixed 8-band curves are RESAMPLED onto whatever
//     the hardware reports, never assumed. describe() is the source of truth.
//  2. Profiles are PER OUTPUT. Phone speakers are bass-shy and earphones
//     aren't, so one curve is wrong on one of them by construction. Each
//     route (speaker / wired / bluetooth) keeps its own, and switching route
//     loads that profile mid-playback.
//
// Default OFF, always: nothing is applied until the user turns it on.

const native =
  TurboModuleRegistry.get('AuraEqualizer') ?? NativeModules.AuraEqualizer ?? null;

// RNTP registers under "TrackPlayerModule" (see its TrackPlayerModule.ts) —
// this is where the ExoPlayer audio session our effects attach to comes from.
const player =
  TurboModuleRegistry.get('TrackPlayerModule') ??
  NativeModules.TrackPlayerModule ??
  null;

const KEY = 'aura.equalizer';
export const OUTPUTS = ['speaker', 'wired', 'bluetooth'];
export const ROUTE_EVENT = 'aura-audio-route';

// ── the web's mood presets, as (frequency → dB) anchors ──────────────────
// Ported verbatim from AI Music Development/src/audio/eqConfig.js. Kept as
// anchor pairs rather than a bare array because the device's band centers
// won't match the web's — resample() reads the curve AT the device's own
// frequencies.
const WEB_FREQS = [60, 150, 400, 1000, 2400, 6000, 12000, 16000];

export const PRESETS = [
  { id: 'flat', name: 'flat', gains: [0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'loud', name: 'loud', gains: [4, 3, 0.5, 1, 2, 2, 3, 4] },
  { id: 'clarity', name: 'vocal clarity', gains: [0, 0, 1, 2.5, 4, 2, 0, 0] },
  { id: 'focused', name: 'focused', gains: [-1, 0, 0, 2, 3, 1.5, 0, -0.5] },
  { id: 'upbeat', name: 'upbeat', gains: [4, 2, 0, -0.5, 1, 2.5, 3.5, 4] },
  { id: 'social', name: 'social', gains: [1.5, 1.5, 2, 3, 2.5, 1.5, 1, 1] },
  { id: 'warm', name: 'warm', gains: [3, 3, 1.5, 0.5, 0, -1, -1.5, -2] },
  { id: 'calm', name: 'calm', gains: [1.5, 2, 1, 0, -0.5, -1, -1.5, -1.5] },
];

// Read a web curve at an arbitrary frequency. Interpolation is LOG-frequency
// because hearing is: 60→150 Hz is the same musical distance as 6k→15k, and
// interpolating linearly would drag every midrange value toward the treble
// anchors. Outside the web's range the nearest anchor holds.
export function curveAt(gains, hz) {
  if (hz <= WEB_FREQS[0]) {
    return gains[0];
  }
  const last = WEB_FREQS.length - 1;
  if (hz >= WEB_FREQS[last]) {
    return gains[last];
  }
  let i = 0;
  while (i < last && WEB_FREQS[i + 1] < hz) {
    i += 1;
  }
  const lo = WEB_FREQS[i];
  const hi = WEB_FREQS[i + 1];
  const ratio = Math.log(hz / lo) / Math.log(hi / lo);
  return gains[i] + (gains[i + 1] - gains[i]) * ratio;
}

// A web preset → this device's bands, in MILLIBELS (the unit Android speaks),
// clamped to what the hardware actually accepts.
export function resample(gains, bands) {
  return bands.map(b => {
    const mb = Math.round(curveAt(gains, b.centerHz) * 100);
    return Math.max(b.minMb, Math.min(b.maxMb, mb));
  });
}

// ── state ────────────────────────────────────────────────────────────────
const blank = () => ({
  enabled: false,
  bassBoost: 0,
  // null = follow the detected route; a value pins the profile by hand
  // (routing on OEM ROMs is never perfectly reportable).
  override: null,
  profiles: {},
});

function read() {
  try {
    const raw = JSON.parse(storage.getItem(KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') {
      return blank();
    }
    return { ...blank(), ...raw, profiles: raw.profiles ?? {} };
  } catch {
    return blank();
  }
}

let state = read();
let bands = []; // from describe() — empty until the device answers
let available = false;
let unavailableReason = null;
let output = 'speaker';
let attached = false;
const subs = new Set();

function emit() {
  for (const cb of subs) {
    cb(getEqualizer());
  }
}

function persist() {
  try {
    storage.setItem(KEY, JSON.stringify(state));
  } catch {
    // storage full / disabled — the live settings still hold for this session
  }
}

export function subscribeEqualizer(cb) {
  subs.add(cb);
  return () => subs.delete(cb);
}

// The profile currently being edited/applied: the pinned one if set, else the
// live route.
export function activeOutput() {
  return state.override ?? output;
}

// A profile always has one entry per DEVICE band; a stored profile from a
// different band count (device changed, effect swapped) is discarded rather
// than misapplied.
export function profileFor(name) {
  const p = state.profiles[name];
  if (Array.isArray(p) && bands.length && p.length === bands.length) {
    return p;
  }
  return bands.map(() => 0);
}

export function getEqualizer() {
  return {
    available,
    unavailableReason,
    enabled: state.enabled,
    bassBoost: state.bassBoost,
    bands,
    output: activeOutput(),
    detectedOutput: output,
    pinned: state.override != null,
    gains: profileFor(activeOutput()),
  };
}

// ── native plumbing ──────────────────────────────────────────────────────
// The session id changes whenever the service recreates the player, so it is
// re-read on every attach and never cached across one.
async function attachToSession() {
  if (!native || !player?.getAudioSessionId) {
    return false;
  }
  try {
    const session = await player.getAudioSessionId();
    if (!session) {
      return false; // no real session — stay off, never touch session 0
    }
    attached = await native.attach(session);
    crumb('eq', 'attach', { session, ok: attached });
    return attached;
  } catch {
    attached = false;
    return false;
  }
}

// Push the whole current profile at the hardware.
async function applyAll() {
  if (!native || !available) {
    return;
  }
  if (state.enabled && !attached) {
    await attachToSession();
  }
  if (!attached) {
    return;
  }
  try {
    const gains = profileFor(activeOutput());
    for (let i = 0; i < gains.length; i += 1) {
      await native.setBandLevel(i, gains[i]);
    }
    await native.setBassBoost(state.bassBoost);
    await native.setEnabled(state.enabled);
  } catch {
    // A mid-flight failure (session died) just leaves the effect off; the
    // next enable/attach re-establishes it.
  }
}

// Called once from the app shell. Reads what the device offers, starts
// watching the output route, and re-applies if the user had it on.
export async function initEqualizer() {
  if (!native) {
    available = false;
    unavailableReason = 'not supported on this device';
    emit();
    return;
  }
  try {
    const d = await native.describe();
    available = !!d.available;
    unavailableReason = d.reason ?? null;
    bands = Array.isArray(d.bands) ? d.bands : [];
    output = d.output ?? 'speaker';
  } catch (e) {
    available = false;
    unavailableReason = e?.message ?? 'unavailable';
  }
  if (available) {
    try {
      await native.startRouteWatch();
      const emitter = new NativeEventEmitter(native);
      emitter.addListener(ROUTE_EVENT, ev => {
        const next = ev?.output ?? 'speaker';
        if (next === output) {
          return;
        }
        output = next;
        // Switching route swaps to that route's curve mid-playback.
        emit();
        applyAll();
      });
    } catch {
      // route watching is a nicety — the equalizer still works without it
    }
    // The service can recreate the player (and with it the audio session)
    // while we're in the background, which silently detaches the effect.
    // Coming back to the foreground re-establishes it.
    AppState.addEventListener('change', s => {
      if (s === 'active' && state.enabled && !attached) {
        applyAll();
      }
    });
    if (state.enabled) {
      await applyAll();
    }
  }
  emit();
}

// ── actions ──────────────────────────────────────────────────────────────
export async function setEnabled(on) {
  state = { ...state, enabled: !!on };
  persist();
  emit();
  if (!on && native && attached) {
    try {
      await native.setEnabled(false);
      await native.release();
    } catch {
      // nothing to recover — the effect is going away either way
    }
    attached = false;
    return;
  }
  await applyAll();
}

export async function setBand(index, millibels) {
  const name = activeOutput();
  const next = profileFor(name).slice();
  const band = bands[index];
  if (!band) {
    return;
  }
  next[index] = Math.max(band.minMb, Math.min(band.maxMb, Math.round(millibels)));
  state = { ...state, profiles: { ...state.profiles, [name]: next } };
  persist();
  emit();
  if (!state.enabled || !native) {
    return;
  }
  // Not attached yet — the usual reason is that the equalizer was already ON
  // from a previous run, so init() tried to attach before the player had an
  // audio session. Attach now and push the whole curve, instead of dropping
  // the change on the floor and waiting for an off/on cycle to fix it.
  if (!attached) {
    await applyAll();
    return;
  }
  try {
    await native.setBandLevel(index, next[index]);
  } catch {
    // ignored — the value is stored and re-applied on the next attach
  }
}

// Drop a whole curve onto the active profile — how a saved user preset is
// applied (lib/eqPresets). Values are clamped per band, so a curve saved on
// hardware with a wider range can't push this one past what it accepts.
export async function applyGains(gains) {
  if (!Array.isArray(gains) || gains.length !== bands.length || !bands.length) {
    return;
  }
  const name = activeOutput();
  const safe = gains.map((mb, i) =>
    Math.max(bands[i].minMb, Math.min(bands[i].maxMb, Math.round(mb))),
  );
  state = { ...state, profiles: { ...state.profiles, [name]: safe } };
  persist();
  emit();
  await applyAll();
}

export async function applyPreset(id) {
  const preset = PRESETS.find(p => p.id === id);
  if (!preset || !bands.length) {
    return;
  }
  const name = activeOutput();
  state = {
    ...state,
    profiles: { ...state.profiles, [name]: resample(preset.gains, bands) },
  };
  persist();
  emit();
  await applyAll();
}

export async function setBassBoost(strength) {
  state = { ...state, bassBoost: Math.max(0, Math.min(1000, Math.round(strength))) };
  persist();
  emit();
  if (!state.enabled || !native) {
    return;
  }
  if (!attached) {
    await applyAll(); // same lazy attach as setBand
    return;
  }
  try {
    await native.setBassBoost(state.bassBoost);
  } catch {
    // stored; re-applied on the next attach
  }
}

// Pin the profile by hand, or pass null to follow the detected route again.
export function pinOutput(name) {
  state = { ...state, override: name && OUTPUTS.includes(name) ? name : null };
  persist();
  emit();
  applyAll();
}

// Which preset (if any) the current curve matches — for highlighting the chip.
export function matchingPreset() {
  if (!bands.length) {
    return null;
  }
  const gains = profileFor(activeOutput());
  const hit = PRESETS.find(p =>
    resample(p.gains, bands).every((mb, i) => Math.abs(mb - gains[i]) <= 25),
  );
  return hit?.id ?? null;
}
