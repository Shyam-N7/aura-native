# AURA Native — Feature Phase (4a Up Next reorder · 4b volume booster)

## 4a Reorderable Up Next — AUDIT RESULT: already built; two cheap adds remain

Checked requirement-by-requirement against `src/overlays/QueueSheet.jsx` (1,416 lines,
ported from the web DesktopQueue) + `PlayerContext.reorder` (:635-647):

| Requirement | Status |
|---|---|
| Drag handle + drag-and-drop | ✅ grip pan; the pan BLOCKS list scroll (arbitration documented at :123) |
| Haptic feedback | ✅ `Vibration.vibrate` on lift + step (:166, :171) |
| Applies to the LIVE queue, no desync | ✅ drop → `reorder(from,to)` → `engine.syncQueue` same-current tier: removes/re-adds AROUND the active item |
| Playing item never restarts | ✅ same-current tier never touches the active native item |
| Safe while playing/paused/loading | ✅ all engine mutations serialize through the op queue; boundary races resolved via `getActiveIndex` re-read |
| Persist immediately | ✅ `applyQueue` persists on every mutation |
| Swipe/one-tap remove | ✅ `removeAt` with animated exit + a11y label (:456-460) |
| Virtualized 60fps on long queues | ✅ mount-window widening during drag (:70-75) so the dragged cell can't unmount; **500-item frame-timing pass still owed** (`dumpsys gfxinfo` while dragging a long synthetic queue) |
| "play next" | ✅ app-wide via the track ⋯ menu |
| "move to top" | ❌ not present — cheap add: one row action calling `reorder(i, idx+1)` |

**Remaining work:** move-to-top row action; a 500-item `gfxinfo` frame pass. Nothing else
— rebuilding this surface would be regression risk for zero gain.

## 4b Volume booster without quality loss — research + recommendation

**Why naive gain fails:** multiplying samples past full-scale hard-clips — distortion is
guaranteed, exactly what the brief forbids. Every real design = added gain **into a
limiter** with headroom.

**Options on this platform (min SDK 26, session-attached like the EQ):**

| Approach | Coverage | Quality | Notes |
|---|---|---|---|
| `LoudnessEnhancer` (API 19+) | universal | OK to ~+6 dB; NO true limiter — internal behavior above that varies by OEM, can clip | already attached by `AuraEqualizerModule` |
| `DynamicsProcessing` (API 28+) | all but 26/27 | proper chain: input gain → MBC → **limiter** stage with attack/release/threshold | the correct tool; CPU cost small (device DSP where offloaded) |
| ExoPlayer custom `AudioProcessor` (soft-clipper in-app) | all | full control, float pipeline | disables audio offload (battery), needs kotlin-audio surgery — not justified while DynamicsProcessing exists |
| Per-track gain normalization | all | no boost, just consistency | ALREADY SHIPPED as leveling — complementary, not a booster |

**Recommendation:** `DynamicsProcessing` on API 28+ — input gain up to **+12 dB** into
its limiter (threshold ≈ −1 dBFS, attack 1 ms, release 60 ms) so boosted peaks compress
instead of clipping. On API 26–27 fall back to `LoudnessEnhancer` **capped at +6 dB**
(below where OEM implementations misbehave). Both attach to the SAME audio session the
EQ uses, from the same module — stable across tracks for free (the EQ already proved the
session survives the queue).

**Interactions (each a hard requirement):**
- **EQ stacking:** boost + a +10 dB EQ band must not sum past the limiter's ceiling —
  the limiter catches it by construction on 28+; on the 26/27 fallback, cap
  (boost + max EQ band) ≤ +12 dB in `lib/equalizer.js` before it reaches the effect.
- **Leveling:** leveling owns *player volume* (multiplicative, ≤1.0) — orthogonal to a
  post-mix gain effect; no ownership conflict. Verified rule stays: one owner per knob.
- **System volume / focus ducking / route change:** effects sit on the session, so duck
  and volume ride through them; route change re-applies via the existing route watcher.
- **Safety:** warning copy + haptic at >+6 dB ("this can distort on some songs and harm
  hearing at high volume"); boost persists per-output profile like EQ curves.

**Quality verification (A/B, not vibes):** API 29+ `AudioPlaybackCapture` lets the app
capture ITS OWN output. Dev-only screen: play a bundled −12 dBFS sine sweep + a real
track snippet at boost 0/+6/+12, capture, then compute clipped-sample count and THD
offline. Acceptance: zero hard-clipped samples at any setting; THD rise < 1% at +6 dB.

**Effort:** module methods (attach/gain/limiter config) S; settings UI + warning S;
capture-verify harness M. **Risk:** OEM DynamicsProcessing quirks (ColorOS) — mitigated
by the probe-first pattern used for the EQ (describe → gate UI on availability).

### Status (2026-07-28, shipped 9b6f9fa)
Built as designed: DynamicsProcessing gain→limiter (28+), LoudnessEnhancer fallback with
a native ≤+6 dB cap (so even a UI/mode mismatch cannot exceed it), stacking cap pinned
by 5 tests, warning gate on >+6 dB stops. **Verified:** compile, full jest (233), APK on
device, effect libraries present in audio_flinger. **Deliberately not verified yet:**
attached-chain inspection needs the EQ enabled, which is the user's persisted choice
(currently off) — flipping it during an unattended test session was out of bounds. First
real enable verifies it; the eq-attach breadcrumb reports it fleet-wide.
### Correction (2026-07-28 review): the limiter ratio was too low to hold the ceiling
The design above fixed threshold, attack and release but never pinned the **ratio**, and
it shipped at 10:1. Output above the threshold is `threshold + over/ratio`, so a master
peaking at 0 dBFS at the slider's full +12 dB arrives 13 dB over and leaves at
`−1 + 13/10 = +0.3 dBFS` — clipping, above roughly +9 dB of boost. Now **20:1**, which
lands at −0.35 dBFS and leaves headroom for bass boost (which the JS stacking cap does
not discount — the limiter is what actually catches it). Verified by compile and by the
arithmetic; the capture harness below is still what would *measure* it.

**Named deferred:** AudioPlaybackCapture THD harness (needs a bundled sine asset);
500-item drag `gfxinfo` pass (needs a dev hook to inject a synthetic queue); true-gapless
(<100 ms) Media3 depth — only if the measured ≤650 ms boundary still feels wrong.
