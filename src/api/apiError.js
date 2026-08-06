// One error for a failed API read, in the app's voice.
//
// Every one of these throws lands on a screen that renders the message
// verbatim next to its own prefix — `Couldn't load — {hit.error}`. So the
// string an api module invents IS user-facing copy, and several were written
// as if they were not: a user offline on liked songs read
//
//     Couldn't load — likes fetch failed (500)
//
// which says the same thing twice and then shows them a status code. The three
// worst offenders (likes, playlists, discover) never even looked at the
// server's own `error` field, so there was nothing better to fall back to.
//
// Order of preference: what the server said, then a plain sentence chosen by
// status class. The status and code still ride the Error for callers that
// branch on them.
export async function apiError(res, subject) {
  let body = {};
  try {
    body = (await res.json()) ?? {};
  } catch {
    // Not JSON — an edge 502, an HTML error page, a captive portal. The
    // status is still meaningful, which is the whole point of not letting a
    // parse failure escape.
  }
  const fromServer =
    typeof body.error === 'string' && body.error.trim() ? body.error : null;
  const message =
    fromServer ??
    (res.status >= 500
      ? 'the server is having trouble — try again in a moment'
      : res.status === 404
      ? `we couldn't find ${subject}`
      : `${subject} didn't load`);
  return Object.assign(new Error(message), {
    status: res.status,
    code: body.code,
  });
}
