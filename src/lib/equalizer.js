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
// AuraEqualizerModule fires this when the session's effect control moves.
const CONTROL_EVENT = 'aura-audio-eq-control';

// ── the web's mood presets, as (frequency → dB) anchors ──────────────────
// Ported verbatim from AI Music Development/src/audio/eqConfig.js. Kept as
// anchor pairs rather than a bare array because the device's band centers
// won't match the web's — resample() reads the curve AT the device's own
// frequencies.
const WEB_FREQS = [60, 150, 400, 1000, 2400, 6000, 12000, 16000];

export const PRESETS = [
  { id: 'flat', name: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'loud', name: 'Loud', gains: [4, 3, 0.5, 1, 2, 2, 3, 4] },
  { id: 'clarity', name: 'Vocal clarity', gains: [0, 0, 1, 2.5, 4, 2, 0, 0] },
  { id: 'focused', name: 'Focused', gains: [-1, 0, 0, 2, 3, 1.5, 0, -0.5] },
  { id: 'upbeat', name: 'Upbeat', gains: [4, 2, 0, -0.5, 1, 2.5, 3.5, 4] },
  { id: 'social', name: 'Social', gains: [1.5, 1.5, 2, 3, 2.5, 1.5, 1, 1] },
  { id: 'warm', name: 'Warm', gains: [3, 3, 1.5, 0.5, 0, -1, -1.5, -2] },
  { id: 'calm', name: 'Calm', gains: [1.5, 2, 1, 0, -0.5, -1, -1.5, -1.5] },
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
  // Volume boost in millibels (docs/perf/04 4b). Rides the equalizer's
  // enabled switch like bass boost does.
  boostMb: 0,
  // null = follow the detected route; a value pins the profile by hand
  // (routing on OEM ROMs is never perfectly reportable).
  override: null,
  profiles: {},
});

// Boost + EQ must never stack past what the limiter absorbs: total added
// gain (boost + the hottest positive band) caps at +12 dB, and the
// LoudnessEnhancer fallback ("plain") caps at +6 dB outright — OEM behavior
// above that clips, which is the one thing this feature must never do.
export function cappedBoostMb(boostMb, gains, mode) {
  const ceiling = mode === 'plain' ? 600 : 1200;
  const hottest = Math.max(0, ...(gains ?? []).map(g => g || 0));
  return Math.max(0, Math.min(boostMb, ceiling - Math.min(hottest, ceiling)));
}

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
// Two different questions, and conflating them is how the panel came to lie.
// deviceEq: does this phone grant an equalizer at all. available: can the
// panel be trusted RIGHT NOW — i.e. is there an effect we actually control.
// They part company the moment an OEM sound stack takes the session.
let deviceEq = false;
let available = false;
let unavailableReason = null;
let boostMode = 'none'; // 'limiter' (DynamicsProcessing) | 'plain' | 'none'
let output = 'speaker';
let attached = false;
// WHICH session `attached` refers to. Held so a foreground can tell "still the
// same player" from "the service rebuilt it underneath us" — attached alone
// cannot, and every recovery path is gated on !attached, so a stale true would
// leave the panel switched on over audio nothing is processing.
let attachedSession = 0;
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
    // Exposed so the panel can tell "this phone has no equalizer" from "it has
    // one, just not right now" — the same distinction the two flags above draw.
    // Without it the screen prints a permanent verdict over a temporary reason.
    deviceEq,
    unavailableReason,
    enabled: state.enabled,
    bassBoost: state.bassBoost,
    boostMb: state.boostMb,
    boostMode,
    bands,
    output: activeOutput(),
    detectedOutput: output,
    pinned: state.override != null,
    gains: profileFor(activeOutput()),
  };
}

// ── native plumbing ──────────────────────────────────────────────────────
// Plain words for the codes AuraEqualizerModule rejects with. The panel has
// exactly one channel for bad news — unavailableReason — so everything that
// means "the faders are not doing anything" is said through here.
const REASONS = {
  no_control: 'another app is controlling the sound right now',
  session_gone: 'start a song and open this again',
  attach_failed: "the system wouldn't allow it",
  enable_failed: "the system wouldn't turn it on",
};

function reasonFor(e) {
  return REASONS[e?.code] ?? e?.message ?? 'not available right now';
}

// Nothing is being applied — stop showing a panel that says otherwise. Field
// report: ColorOS/Realme with Dolby (and Samsung UHQ, Xiaomi Mi Sound) leave
// the switch reading ON, the faders live, and the audio untouched, because
// they own the session and our effect never had control.
// Recoverable by construction: deviceEq stays true, so the next foreground,
// enable, or control-granted event re-attaches and clears this.
function lostControl(reason) {
  attached = false;
  attachedSession = 0;
  available = false;
  unavailableReason = reason;
  crumb('eq', 'lost', { reason });
  emit();
}

function regained() {
  if (available) {
    return;
  }
  available = true;
  unavailableReason = null;
  emit();
}

// The session id changes whenever the service recreates the player, so it is
// re-read on every attach and never cached across one.
async function attachToSession() {
  if (!native || !player?.getAudioSessionId) {
    return false;
  }
  let session = 0;
  try {
    session = await player.getAudioSessionId();
  } catch {
    // The player isn't up yet — not a failure, just not now. Breadcrumbed
    // because the SILENCE here is what made the cold-start hole invisible: on
    // a launch with the EQ already on, this rejects (the service has not bound
    // yet), attached stays false, and nothing retries until the user toggles
    // something. notePlayerReady() is the retry; this is how we see it.
    crumb('eq', 'attach-skip', { reason: 'player-not-ready' });
    return false;
  }
  if (!session) {
    crumb('eq', 'attach-skip', { reason: 'no-session' });
    return false; // no real session — stay off, never touch session 0
  }
  try {
    attached = await native.attach(session);
    attachedSession = attached ? session : 0;
    crumb('eq', 'attach', { session, ok: attached });
    return attached;
  } catch (e) {
    // Refused, which is not the same as "not yet": the effect exists and we
    // don't drive it. Say so.
    lostControl(reasonFor(e));
    return false;
  }
}

// Push the whole current profile at the hardware.
async function applyAll() {
  if (!native || !deviceEq) {
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
    // The stacking cap re-derives from the LIVE curve, so a hotter preset
    // automatically pulls the boost down instead of clipping.
    await native.setBoost(
      state.enabled ? cappedBoostMb(state.boostMb, gains, boostMode) : 0,
    );
    // false = nothing attached on the native side after all. A promise that
    // merely resolved used to be reason enough to keep claiming it worked.
    const ok = await native.setEnabled(state.enabled);
    if (state.enabled && ok === false) {
      lostControl(REASONS.session_gone);
      return;
    }
  } catch (e) {
    // A mid-flight failure (session died, an OEM effect took it) leaves the
    // effect off — name which one instead of swallowing it. The next
    // enable/attach re-establishes it.
    lostControl(reasonFor(e));
    return;
  }
  regained();
}

// What the device offers, asked on one session. describe() is cheap and
// leaves nothing attached, so it can be asked more than once.
async function probe(session) {
  try {
    const d = await native.describe(session);
    deviceEq = !!d.available;
    available = deviceEq;
    unavailableReason = d.reason ?? null;
    bands = Array.isArray(d.bands) ? d.bands : [];
    boostMode = d.boost ?? 'none';
    output = d.output ?? 'speaker';
  } catch (e) {
    deviceEq = false;
    available = false;
    unavailableReason = e?.message ?? 'unavailable';
  }
  return deviceEq;
}

// Session 0 is the global output MIX. A ROM can refuse effects there and
// still grant them per session — which read as "this phone has no equalizer"
// and stopped the app from ever trying the real attach. So the answer from
// session 0 is never the last word: ask again on the player's own session
// once there is one. Never while we hold that session, or the throwaway probe
// would take control off our own effect.
async function probeSession() {
  if (deviceEq || attached || !player?.getAudioSessionId) {
    return false;
  }
  try {
    const session = await player.getAudioSessionId();
    return session ? await probe(session) : false;
  } catch {
    return false;
  }
}

let watching = false;

// Everything that only makes sense once the device has said yes: watch the
// output route, and put back whatever the user had on. Runs at init, or later
// if the real-session probe is what finally answered.
async function settle() {
  if (!watching) {
    watching = true;
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
      // Control of the session can move at any time (the OEM sound app is
      // opened mid song, or closed again). Losing it means the faders stop
      // meaning anything; getting it back means our curve has to go on again.
      emitter.addListener(CONTROL_EVENT, ev => {
        if (!ev?.control) {
          lostControl(REASONS.no_control);
          return;
        }
        regained();
        applyAll();
      });
    } catch {
      // route watching is a nicety — the equalizer still works without it
    }
  }
  if (state.enabled) {
    await applyAll();
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
  if (!(await probe(0))) {
    await probeSession();
  }
  // Two jobs on the way back to the foreground. The service can recreate the
  // player (and with it the audio session) while we're away, which silently
  // detaches the effect — and if session 0 was the only answer this device
  // ever gave, this is the chance to ask it again with a real session.
  AppState.addEventListener('change', async s => {
    if (s !== 'active') {
      return;
    }
    if (!deviceEq) {
      if (await probeSession()) {
        await settle();
        emit();
      }
      return;
    }
    if (state.enabled && !attached) {
      await applyAll();
      return;
    }
    // Attached — but to WHICH session? The service can rebuild the player while
    // we're away, and the new one carries a new session id, leaving this effect
    // bound to a dead one with the switch still reading on. Only a definite
    // answer that definitely differs counts: a rejection or a 0 means "don't
    // know", and tearing down a working effect on "don't know" would be worse
    // than the bug. Re-attaching is not free (it rebuilds Equalizer, BassBoost
    // and the limiter), so this must never fire speculatively.
    if (state.enabled && attached && player?.getAudioSessionId) {
      try {
        const live = await player.getAudioSessionId();
        if (live && live !== attachedSession) {
          crumb('eq', 'session-moved', { from: attachedSession, to: live });
          attached = false;
          await applyAll();
        }
      } catch {
        // no answer — leave the working effect exactly as it is
      }
    }
  });
  if (deviceEq) {
    await settle();
  }
  emit();
}

/**
 * The player just finished setting up, so an audio session now exists.
 *
 * initEqualizer runs from the app shell, which is well before the playback
 * service has bound — so on a launch with the EQ already ON, its attach asks
 * for a session id, gets `player_not_initialized`, and gives up. Nothing
 * retried: the AppState handler needs a foreground TRANSITION (a cold start is
 * not one), the route callback early-returns when the route hasn't changed, the
 * control-granted event cannot fire when no effect exists, and the panel only
 * subscribes on mount. The switch read ON with live faders over completely
 * unprocessed audio, for the whole first session.
 *
 * Called from engine.setupPlayer, deliberately un-awaited: a device that
 * refuses audio effects must never delay or fail player setup.
 */
export async function notePlayerReady() {
  // Cheapest guard first — this runs inside the playback engine's boot, and on
  // a device with no equalizer module (and in every playback test) it must cost
  // nothing and touch nothing.
  if (!native || !deviceEq || !state.enabled || attached) {
    return;
  }
  await applyAll();
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
    attachedSession = 0;
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

export async function setBoost(mb) {
  state = { ...state, boostMb: Math.max(0, Math.min(1200, Math.round(mb))) };
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
    await native.setBoost(
      cappedBoostMb(state.boostMb, profileFor(activeOutput()), boostMode),
    );
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
