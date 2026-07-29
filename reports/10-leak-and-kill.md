# The screen-off kill, caught — and the leak behind it, fenced

Night session, 2026-07-29 → 30. Device: RMX3371 (owner's phone, ColorOS 14 / Android 14), release build of `ea7bd89`-equivalent code, private session ON for all playback below, volume 0, playback verified by `AudioPlaybackConfiguration state:started`, screen state verified per sample. Control device: OnePlus 6T (OxygenOS 11 / Android 11), same APK, same account.

## 1. Criterion 2 — closed

Push sent from the admin console on a second device, received on this phone **locked and screen-off** at 00:57:43 (arrival watch polling at 2 s):

```
NotificationRecord ... tag=FCM-Notification:... importance=4
Notification(channel=aura.push.v1 ... color=0xffd97757)
mWakefulness: Dozing → Awake   (the card lit the lock screen)
```

New server code confirmed live (deployed `dev→main`, `bdfa59f`): priority high + explicit channel, landing in `aura.push.v1` at `IMPORTANCE_HIGH`. Caveat recorded: phone was on the cable, so deep Doze could not engage — send path, channel routing, and delivery latency are proven; the off-charger dozing variant remains a by-eye test.

## 2. Criterion 3 — the kill, on camera

12-minute screen-off soak (per-minute sampler: pid, screen, audio, PSS). Playback survived the full window, pid 8848 stable, audio rendering every sample. Then:

```
07-30 01:18:27.208  am_proc_died: [0, 8848, live.aurafm.app, 200, 4]
```

**oom_adj 200 / proc_state 4** — the process died while still a *perceptible foreground service actively playing*. No `lmkd` record: this is the ROM's own killer (the long-suspected ColorOS o-kill), and this is the first time it has been caught under instrumentation rather than reported from the field.

**Motive:** PSS had climbed from 445 MB (t+1) to **741 MB (t+12)**, with 346 MB already pushed to swap.

**Restore verdict: pass.** The service restarted (new pid), session came back **paused at position 236656 ms** — mid-track, honest pause, exactly the designed post-kill behaviour. The user-facing symptom is "music stopped"; state was not lost.

## 3. The leak — fenced by three experiments

| Experiment | Condition | Result |
|---|---|---|
| Soak (above) | playing, screen off, effects on | +25–46 MB/min, monotonic |
| **Control** | **paused**, screen off | **Flat.** `Gfx dev` frozen byte-for-byte; PSS *fell* (swap-out) |
| Category trace | playing, screen off | `Gfx dev` and `EGL` **flat**; `Dalvik` flat; **TOTAL climbing** |
| **Effects A/B** | playing, screen off, **leveling OFF + EQ OFF** | **Still climbing at the same rate** |

Category autopsy across the playing window (same process):

```
Native Heap alloc:  179.5 → 211.1 → 240.1 → 274.3 → 313.0 MB   (~33 MB/min)
Gfx dev:            62 MB flat      Dalvik: ~22 MB flat      Unknown: ~37 MB flat
Heap free at last sample: 41 MB of a 354 MB arena — the next kill minutes away
```

**Conclusions, each earned by elimination:**
- The leak is **native-heap malloc**, strictly **playback-gated** (paused = flat), **UI-independent** (screen off throughout; graphics categories flat), **JS-independent** (Hermes/Dalvik flat), and **not the audio-effects chain** (identical slope with leveling + EQ disabled).
- It is **ROM/OS-specific**: the identical APK, account, and protocol on the OnePlus 6T (Android 11) holds flat at ~280 MB indefinitely.
- What remains is the **player/stream native path on ColorOS 14 / Android 14**: ExoPlayer's pipeline (codec client buffers — Codec2/bufferpool are in-process native allocations), the platform audio client, or the HTTP/cache datasource stack. Naming the allocator requires malloc callstacks.

## 4. Next steps (proposed, not started)

1. **Add `android:profileable android:shell="true"` to the manifest** (one line; Google-sanctioned for release builds) → rebuild → **heapprofd** capture during a 5-minute screen-off playback trace → the exact malloc stacks, and with them the fix (or the upstream bug report with proof).
2. Cheap config A/Bs if heapprofd is blocked: disk cache set to 0, buffer config default vs current (`playBuffer 2.5 / minBuffer 30 / maxBuffer 120`), pinned quality vs auto.
3. Interim honesty for the product: on this ROM the app currently survives roughly **10–20 minutes of screen-off playback per process** before the ROM executes it (growth from a ~290 MB baseline to a ~740 MB kill threshold at 27–46 MB/min); recovery restores the session paused. Fix priority accordingly.

## 5. Session tooling worth keeping

- `scripts/adbq.sh` (AI Music repo) + a `Bash(bash scripts/adbq.sh *)` allow rule: static-permission adb access, created when the harness's auto-approval model went down mid-forensics. The rule was added by the owner.
- `input motionevent DOWN/MOVE…/UP` chains drive gesture-handler pans on OxygenOS (not ColorOS) — machine-driven drag testing exists now; `sendevent` is permission-denied unrooted.
- Arrival-watch pattern (2 s notification polling) and per-minute condition samplers (screen/audio/pid/PSS) both earned their keep tonight.
