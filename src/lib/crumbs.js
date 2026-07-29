import * as Sentry from '@sentry/react-native';

// Playback breadcrumbs (docs/perf/01 §3). One tiny seam so call sites never
// import the vendor: crumb('playback', 'track-change', {id}) lands in the
// Sentry trail every crash/ANR carries. Deliberately fire-and-forget and
// exception-proof — telemetry must never be able to take playback down.
export function crumb(category, message, data) {
  try {
    Sentry.addBreadcrumb({
      category,
      message,
      data,
      level: 'info',
    });
  } catch {
    // never let telemetry throw into the player
  }
}

// Terminal failures — the dead ends a user actually feels. crumb() alone can
// never report one: breadcrumbs only leave the device attached to an EVENT, so
// a failure that is caught and handled (which is nearly all of them here) ships
// nothing at all. This is the event, and it drags the whole breadcrumb trail
// with it. Reserve it for genuine dead ends — one per give-up, never per retry
// — or the trail drowns. Same fire-and-forget contract as crumb().
export function report(err, where, data) {
  try {
    Sentry.captureException(
      err instanceof Error ? err : new Error(String(err ?? where)),
      { tags: { where }, extra: data },
    );
  } catch {
    // never let telemetry throw into the player
  }
}
