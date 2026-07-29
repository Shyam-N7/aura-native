# Drag auto-scroll "shakiness" — investigation, attempted fix, revert

Field report (owner, RMX3371): dragging a song from the bottom of the queue to the very top is "shaky". Instruction was to reproduce and test without a human finger. This file records what was established, what was tried, and why the code change was **reverted**.

Device for all measurements: OnePlus 6T (sdm845, OxygenOS 11 / API 30), release builds, queue of 41–42 real tracks. All numbers labelled per run.

---

## 1. A drag can be machine-driven after all — on this ROM

The standing constraint said adb cannot drive a gesture-handler pan (`input swipe` / `draganddrop` / `motionevent` all land as taps — proven on the RMX3371/ColorOS). Two new results:

- `sendevent` (raw `/dev/input` injection): **Permission denied** on an unrooted device. Closed permanently for non-rooted phones.
- **`input motionevent DOWN/MOVE…/UP` chains DO drive the pan on the 6T/OxygenOS 11** — row lifts, drop line tracks, auto-scroll arms, drop commits. Each `input` exec costs ~1–2 s, so the *travel* phase is slow-motion, but the *hold* phase (finger parked in the edge zone while auto-scroll sprints) is fully genuine: no injection cadence in it at all.

The constraint is therefore ColorOS-or-method-specific, not universal. Recorded for future sessions: bottom-to-top drag = `DOWN` on a grip, ~10 `MOVE`s upward, park at y≈340 (inside the top `AUTOSCROLL_EDGE`), sleep, `UP`.

Analysis tooling that worked well: `screenrecord` + ffmpeg **slit-scan** (crop a 12-px column through the grip lane, tile one column per frame → time flows left-to-right; smooth scroll = diagonals, stalls = flat runs, and any card wobble is a jagged band) + `dumpsys gfxinfo framestats` sampled mid-sprint from a second adb connection.

## 2. Baseline behaviour (unfixed code) — measured

Run 1–2, build `63b543b` (pre-fix). Evidence: `assets/drag-baseline-slitscan.png`, framestats.

- **The lifted card is ruler-flat.** The finger-follow transform (pure Reanimated, UI thread) is perfect throughout. The card was never the shaky part.
- **The list offset does not move at all during the sprint.** On this paused queue, the entire hold produced *zero* applied scroll; the queue teleported to its final position at drop. The drop itself committed at `dragTo` = wherever the *math* had integrated to (the top), even though the *view* still showed the bottom — i.e. the baseline can drop a row somewhere the eye never saw.
- Frame scheduling during the sprint is healthy: across ~7.6 s of sampled windows, no inter-frame gap over 50 ms, GPU p99 ≈ 12 ms. Rendering is fine; **only the offset is frozen**.

### Root cause

`QueueSheet`'s auto-scroll frame loop calls Reanimated's `scrollTo()` each frame. On Fabric that is `dispatchCommand` → `schedulerDidDispatchCommand` (verified in the installed Reanimated source: `ReanimatedModuleProxy.cpp:1243`) → a **view-command mount item**. Mount items drain with React mount cycles. During a drag sprint almost nothing commits, so per-frame commands pile up unapplied until some unrelated commit flushes them all — then the *latest* offset lands at once.

- Playing queue → the 1 Hz now-playing progress tick provides the commits → **once-a-second multi-row lurches**. This is the owner's "shaky".
- Paused queue → no commits at all → **frozen until drop, then teleport** (captured on video).

The card is immune because Reanimated applies animated styles through its own ShadowTree path, not mount items — which is exactly why the field impression is "the list jumps around under the card".

## 3. Attempted fix and why it was reverted

Idea: apply the offset from the JS thread via `FlatList.scrollToOffset` — the dispatch path ordinary scrolls use, which demonstrably applies promptly. Queue/commit semantics untouched.

- **v1 — unthrottled `runOnJS` per frame: catastrophic.** While JS is busy, calls queue; each queued call dispatches another stale command; the mount queue floods. Measured: **178 frames ≈ 7.7 fps, p50 133 ms, p99 1950 ms, 100 % janky** — far worse than the bug.
- **v2 — coalesced (one push in flight, push reads the latest target): better but not right.** 702 frames, p50 38 ms (~26–30 Hz), p99 150 ms; the sprint visibly **streams** instead of freezing (`assets/drag-jspush-slitscan.png`, contact sheet), and the drop now lands where the card visually hovers — semantically *safer* than baseline. But the sprint advanced only ~540 dp over an 8-second hold — **~5 % of design speed** — for reasons not diagnosable from outside a release build (the dt-compensated integration should be immune to frame starvation; it is not, and release builds emit no JS logs to instrument why).

Two attempts is the agreed retry budget. **Reverted to baseline; clean build reinstalled on the test device.** The investigation, not the patch, is the deliverable.

## 4. What a real fix needs (next session, approved work)

1. **Debug-build instrumentation** of the frame loop (on-screen readout or console-to-logcat, both available in debug): log per-frame `dt`, `vel`, `scrollCmd`, push cadence, and echo-event arrival during a machine-driven sprint. That names the ~5 % mystery in minutes instead of by armchair.
2. Candidate designs to evaluate *with* that data:
   - coalesced JS pushes + echo-cost reduction (the echo → VirtualizedList → 41-mounted-cell reconcile under `DRAG_WINDOW=11` is the suspected per-push cost);
   - a Reanimated-native synchronous offset path if one exists on this version;
   - upstream: this is a known-shaped Fabric issue (worklet `scrollTo` starvation under commit-quiet phases) worth checking against Reanimated's tracker.
3. Whatever ships must be re-measured with the same harness: same injected gesture, slit-scan + framestats, plus a real-finger pass on the RMX3371.

## 5. Side effects on the test device (disclosed, not cleaned up)

- Four real reorders committed to the 6T's signed-in queue by test drags: "Ek Din Teri Raahon", "Bol Do Na Zara" (to #1), "Teri Yaadon Mein", "Mann Mera" (to #22) all moved from the bottom region toward the top.
- Queue header went **42 → 41 tracks** between the first screenshot and the first probe; cause unidentified (no ✕ was near any injected touch; now-playing did not change at that moment). Unresolved.
- The paused now-playing **pointer advanced by one** ("Tujhe Sochta Hoon" → "Kya Mujhe Pyar Hai") between run 3 and run 4, with playback confirmed stopped (`AudioPlaybackConfiguration` count 0) and no tap near any row. Possibly an active-index adjustment bug when a row is inserted above the active track during reorder — **exactly the class of drift the `queueDrift` harness (`2a2b8ab`) exists to catch on a debug build**. Watch item.
