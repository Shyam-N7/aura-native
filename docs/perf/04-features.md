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
