import { storage } from '../storage/mmkv';

// Field-crash black box. A fatal JS error kills the process before anything
// can be reported, so the moment one reaches the global handler we persist it
// to MMKV (synchronous — survives the process death that follows) and then
// let the default handler crash as usual. The next launch can read the record
// (settings shelf shows it) so a crash that happened away from the desk still
// tells us exactly what broke.

const KEY = 'aura.lastCrash';

export function getLastCrash() {
  const raw = storage.getItem(KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearLastCrash() {
  storage.removeItem(KEY);
}

export function installCrashLogger() {
  // ErrorUtils is RN's global fatal hook; missing only in bare test envs.
  if (typeof ErrorUtils === 'undefined') {
    return;
  }
  const prior = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((err, isFatal) => {
    try {
      storage.setItem(
        KEY,
        JSON.stringify({
          at: Date.now(),
          fatal: !!isFatal,
          message: String(err?.message ?? err).slice(0, 400),
          // Enough stack to locate the throw; MMKV isn't a log store.
          stack: String(err?.stack ?? '').slice(0, 1600),
        }),
      );
    } catch {
      // Never let the reporter mask the real crash.
    }
    prior?.(err, isFatal);
  });
}
