#!/usr/bin/env bash
# Install the app on whatever device adb is talking to, open it, and decide
# whether it survived. Nothing more — the defect this exists for killed the app
# on its first drawn frame.
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
# Long enough for RN to boot, the first frames to draw and the glass chrome to
# composite — the blur crash landed one requestAnimationFrame after first paint,
# so a shorter wait would have called that build healthy.
SETTLE_SECONDS=25

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
echo "::endgroup::"

echo "::group::Install"
adb install -r -t "${APK}"
echo "::endgroup::"

adb logcat -c
adb shell monkey -p "${PKG}" -c android.intent.category.LAUNCHER 1 >/dev/null
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

# 2. Did anything fatal land? Checked even when the process is alive: RN can
#    restart after a native throw, so "a process exists" alone is not health.
CRASH="$(adb logcat -d -b crash 2>/dev/null | tr -d '\r' || true)"
if [ -n "${CRASH}" ]; then
  echo "FAIL: crash buffer is not empty."
  echo "${CRASH}"
  FAILED=1
fi

# 3. The crash buffer is not available on every image/level, so also read the
#    main buffer. Scoped to fatals so ordinary warnings do not fail the build.
FATAL="$(adb logcat -d 2>/dev/null | tr -d '\r' | grep -E 'FATAL EXCEPTION|AndroidRuntime: FATAL' || true)"
if [ -n "${FATAL}" ]; then
  echo "FAIL: fatal exception in logcat."
  adb logcat -d | tr -d '\r' | grep -A 40 -E 'FATAL EXCEPTION|AndroidRuntime: FATAL' || true
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
