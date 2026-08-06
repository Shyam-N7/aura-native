// Sentry's default integrations record every outgoing fetch URL as a
// breadcrumb, and some of ours carry a secret IN THE PATH.
//
// The deliberate telemetry in this app is clean — crumb()/report() send track
// ids, error classes, retry counts, boot timings. This is about the breadcrumbs
// nobody wrote: an invite acceptance is
// `/api/playlists/invite/<token>/accept`, and that token is the entire
// authority to join a private playlist. Anyone with report access could lift a
// live one out of a crash trail. Same for a `?join=` share link arriving
// through the deep-link handler.
//
// Redact rather than drop the crumb: knowing an invite was accepted right
// before a crash is exactly the context breadcrumbs exist to give.
const REDACTED = '[redacted]';

// Path secrets: /invite/<token>/accept — keep the shape, lose the value.
const PATH_SECRETS = [/(\/invite\/)[^/?#]+/gi];

// Query secrets, by parameter name. Matched loosely because these arrive from
// share links and push payloads, not from our own request builders.
const QUERY_SECRETS = /([?&](?:join|token|access_token|code)=)[^&#\s]+/gi;

export function scrubUrl(url) {
  if (typeof url !== 'string' || !url) {
    return url;
  }
  let out = url;
  for (const re of PATH_SECRETS) {
    out = out.replace(re, `$1${REDACTED}`);
  }
  return out.replace(QUERY_SECRETS, `$1${REDACTED}`);
}

/**
 * Sentry `beforeBreadcrumb`. Must never throw — a thrown scrubber would take
 * out the breadcrumb pipeline, and losing the whole trail to protect one field
 * is a bad trade.
 */
export function scrubBreadcrumb(breadcrumb) {
  try {
    if (!breadcrumb) {
      return breadcrumb;
    }
    // http breadcrumbs put the URL on data.url; console/navigation ones can
    // carry it in the message.
    if (breadcrumb.data?.url) {
      const cleaned = scrubUrl(breadcrumb.data.url);
      if (cleaned !== breadcrumb.data.url) {
        breadcrumb.data = { ...breadcrumb.data, url: cleaned };
      }
    }
    if (typeof breadcrumb.message === 'string') {
      breadcrumb.message = scrubUrl(breadcrumb.message);
    }
    return breadcrumb;
  } catch {
    // Unrecognised shape — drop it rather than risk shipping the raw one.
    return null;
  }
}
