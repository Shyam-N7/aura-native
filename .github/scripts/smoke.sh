#!/usr/bin/env bash
# Install the app on whatever device adb is talking to, open it, and decide
# whether it survived.
#
# READ THIS BEFORE TRUSTING A GREEN RUN.
#
# This does NOT cover the glass chrome, and the glass chrome is what broke.
# A fresh install has no stored session, so App.jsx renders AuthScreen — and
# AuthScreen's <Glass> passes no `blur` prop. Glass.jsx only mounts
# GlassBackdrop when `blur` is set, and the only two consumers that set it,
# TopBar.jsx:227 and Dock.jsx:417, live inside the signed-in shell. So
# RenderScriptBlur never sees radius 40 here, and run against the 2026-07-30
# regression every job in this matrix would have gone GREEN.
#
# That was the first version of this script, and it is worth being blunt about:
# a safety net aimed at a specific bug that cannot see that bug is worse than no
# net, because it reads as coverage.
#
# What this DOES cover: process start, native module init, the RN bridge, the
# JS bundle downloading and EVALUATING, and React committing its first tree —
# check 3 below waits for perfMarks' `first-render` in logcat. That is a real
# smoke test and it catches a real class of launch crash. It is just not the
# one that prompted it.
#
# Check 3 exists because the first version of this script did NOT observe any of
# that, while its header claimed to. In a debug build a bundle failure shows a
# redbox: the process stays alive and RN logs under tag `ReactNative`, never the
# string `FATAL EXCEPTION`. Both of the other checks passed and the script
# exited 0 for an app that had not run a line of JS.
#
# Closing the gap properly means an instrumented test
# (android/app/src/androidTest) that constructs the controller and asserts the
# clamp directly, which needs native test infrastructure this repo does not
# have yet. Tracked, not pretended.
#
# Run by .github/workflows/device-matrix.yml inside the emulator runner, and
# usable by hand against a real phone:
#
#   adb devices          # make sure exactly one target
#   bash .github/scripts/smoke.sh
#
# A debug APK carries no JS bundle (RN's gradle plugin skips bundling for
# `debuggableVariants`, which defaults to ["debug"]), and a debug build always
# reaches for the dev server because developer support follows BuildConfig.DEBUG.
# So Metro has to be up and reachable. Reversing the port is the same thing you
# would do by hand; it is not a CI trick.

set -euo pipefail

PKG=live.aurafm.app
APK=android/app/build/outputs/apk/debug/app-debug.apk
# How long to watch AFTER the bundle is already built and served. This is a
# settle window, not a build window — the bundle is pre-warmed below, because a
# fixed sleep against a cold Metro is a vacuous test: the first bundle for this
# dependency graph takes a minute or more on a CI runner, so the process would
# still be showing a blank screen when the script declared it healthy.
SETTLE_SECONDS=25
# How long to wait for React's first tree after launch. Generous: a cold API 26
# emulator downloading a dev bundle over adb reverse is slow, and a false
# failure here would be worse than the vacuous pass it replaces.
BOOT_TIMEOUT_SECONDS=90

echo "::group::Start Metro"
npx react-native start --no-interactive >/tmp/metro.log 2>&1 &
METRO_PID=$!
# Kill Metro on any exit path, including the failures below.
trap 'kill "${METRO_PID}" 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  if curl -sf http://localhost:8081/status >/dev/null 2>&1; then break; fi
  sleep 1
done
if ! curl -sf http://localhost:8081/status >/dev/null 2>&1; then
  echo "Metro never came up. Last 50 lines:"
  tail -50 /tmp/metro.log
  exit 1
fi
adb reverse tcp:8081 tcp:8081

# Force the bundle to be built NOW, while we can still block on it and see it
# fail. Metro answers /status the moment it is listening, long before it can
# serve a bundle; this request returns only once the graph is transformed.
echo "Pre-warming the bundle (cold transform, this is the slow part)…"
if ! curl -sf --max-time 900 -o /dev/null \
  'http://localhost:8081/index.bundle?platform=android&dev=true&minify=false'; then
  echo "Metro could not build the bundle. Last 80 lines:"
  tail -80 /tmp/metro.log
  exit 1
fi
echo "::endgroup::"

echo "::group::Install"
adb install -r -t "${APK}"
echo "::endgroup::"

adb logcat -c
adb shell monkey -p "${PKG}" -c android.intent.category.LAUNCHER 1 >/dev/null

# Wait for React to commit a tree, rather than sleeping and hoping. perfMarks
# logs `[perf] first-render <n>ms` from App.jsx's mount effect (__DEV__ only),
# so this line appearing means the bundle downloaded, evaluated, and rendered.
FIRST_RENDER=0
for _ in $(seq 1 "${BOOT_TIMEOUT_SECONDS}"); do
  if adb logcat -d -s ReactNativeJS 2>/dev/null | tr -d '\r' | grep -q '\[perf\] first-render'; then
    FIRST_RENDER=1
    break
  fi
  # A bundle that cannot be fetched is terminal — stop waiting for a render
  # that is never coming and report the real reason.
  if adb logcat -d 2>/dev/null | tr -d '\r' | grep -q 'Unable to download JS bundle'; then
    break
  fi
  sleep 1
done

# Then let it settle, so a crash a beat after first paint is still caught — the
# blur crash landed one requestAnimationFrame after first paint.
sleep "${SETTLE_SECONDS}"

FAILED=0

# 1. Is it still alive? A crash loop leaves no process behind, and this is the
#    check that would have caught the RenderScript radius on API 26-30.
if [ -z "$(adb shell pidof "${PKG}" | tr -d '\r')" ]; then
  echo "FAIL: ${PKG} is not running ${SETTLE_SECONDS}s after launch."
  FAILED=1
else
  echo "OK: still running after ${SETTLE_SECONDS}s."
fi

# 2. Did JS actually run? This is the check whose absence made the whole script
#    able to pass vacuously.
if [ "${FIRST_RENDER}" -ne 1 ]; then
  echo "FAIL: no [perf] first-render within ${BOOT_TIMEOUT_SECONDS}s — the app started but never rendered."
  echo "--- ReactNative / ReactNativeJS tail ---"
  adb logcat -d -s ReactNative:E ReactNativeJS:V 2>/dev/null | tr -d '\r' | tail -40 || true
  FAILED=1
else
  echo "OK: React committed its first tree."
fi

# 3. Did anything fatal land IN OUR PROCESS? Checked even when a process
#    exists: RN can restart after a native throw, so "alive" is not health.
#
#    Scoped to the package on purpose. A google_apis image has GMS and a pile
#    of system services churning in the background, and any one of them
#    crashing inside our 25s window is not our bug — an unscoped check turns
#    this job into a flake generator, and a flaky gate gets ignored, which is
#    the same as not having one.
#
#    `grep -A 40 … | grep PKG` would miss the package name when it sits in the
#    "Process:" line further down, so match the whole block per crash instead.
crash_blocks() {
  adb logcat -d "$@" 2>/dev/null | tr -d '\r' | awk -v pkg="${PKG}" '
    /FATAL EXCEPTION/ { inblk = 1; buf = $0 "\n"; hit = 0; next }
    inblk {
      buf = buf $0 "\n"
      if (index($0, pkg)) { hit = 1 }
      # A crash block is bounded by the next log line that is not a stack
      # frame or a caused-by continuation.
      if ($0 !~ /at |Caused by|\.\.\. [0-9]+ more|Process:|E AndroidRuntime/) {
        if (hit) { printf "%s", buf }
        inblk = 0
      }
    }
    END { if (inblk && hit) printf "%s", buf }
  '
}

OURS="$(crash_blocks -b crash; crash_blocks)"
if [ -n "${OURS}" ]; then
  echo "FAIL: fatal exception in ${PKG}."
  echo "${OURS}"
  FAILED=1
fi

# Context for a human reading a failed run — why the process ended, straight
# from the OS, which is how today's crash was actually identified.
if [ "${FAILED}" -ne 0 ]; then
  echo "::group::exit-info"
  adb shell dumpsys activity exit-info "${PKG}" 2>/dev/null | head -60 || true
  echo "::endgroup::"
fi

exit "${FAILED}"
