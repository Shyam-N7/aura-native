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
