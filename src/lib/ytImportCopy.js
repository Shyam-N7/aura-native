// Every word the YouTube import can say, in one place.
//
// Ported from web src/lib/ytImportCopy.js. The KEYS and the error CODES are the
// contract and are identical to the web's — the server sends {error, code} and
// the client switches on `code`, so a code with no entry here is a missing-key
// crash in development rather than a shrug in production. The STRINGS are the
// part that is allowed to differ, and here they do: this app speaks in
// lowercase (`playlist created.`, `delete "x"?`), and the web's sentence case
// would read as if it had been pasted in from somewhere else. The web file
// anticipates exactly this — "wording can change here, or in a native release,
// without a server deploy".
//
// House style, carried over from the web pack because it is what makes these
// strings worth having:
//  - Say what happened, then what to do. Never only the first.
//  - Blame the situation, not the user. "youtube doesn't allow this" beats
//    "you pasted the wrong thing".
//  - No jargon the user did not introduce. They pasted a link; they did not
//    ask about playlist id prefixes, quotas or OAuth.
//  - No exclamation marks, no "oops".

// ── Link errors: settled before anything is spent ───────────────────
//
// These all come back from /preview or the create call, and every one of them
// is decided from the link alone. Several would otherwise SUCCEED at importing
// nothing, which is why they are worth this much text.
export const LINK_ERRORS = {
  YT_EMPTY: {
    title: 'paste a link to start',
    body: 'copy a youtube playlist or mix link and paste it here.',
  },
  YT_NOT_A_URL: {
    title: "that doesn't look like a link",
    body: 'paste the whole address, starting with youtube.com.',
  },
  YT_NOT_YOUTUBE: {
    title: 'that link is not from youtube',
    body: 'only youtube playlists and mixes can be imported right now.',
  },
  YT_VIDEO_ONLY: {
    // The single most common mistake. The user pasted something real — say so,
    // rather than implying the link was junk.
    title: "that's a single video",
    body: 'open the playlist or mix it belongs to, then copy that link instead.',
  },
  YT_NO_PLAYLIST: {
    title: "that link doesn't have a playlist in it",
    body: 'open the playlist on youtube and copy the link from there.',
  },
  YT_MALFORMED_ID: {
    title: 'that link is missing something',
    body: 'try copying it again from youtube.',
  },
  YT_WATCH_LATER: {
    // Worth being precise: users assume we are the ones refusing.
    title: 'watch later cannot be read by any app',
    body: "youtube keeps it private — not even youtube's own apps can share it. save the videos to a normal playlist and import that.",
  },
  YT_HISTORY: {
    title: 'watch history stays private to youtube',
    body: 'make a playlist from the songs you want, then import that.',
  },
  YT_OAUTH_REQUIRED: {
    title: 'that playlist is tied to your youtube account',
    body: 'in youtube, set it to unlisted or public, then paste the link again.',
  },
  YT_NEEDS_SAVE: {
    // A user-seeded mix (RDMM/RDAMVM). Whether a server key can read these is
    // genuinely untested, so the copy gives the step that always works rather
    // than a claim we cannot stand behind.
    title: 'that mix was built for your account',
    body: 'open it in youtube, tap save, then paste the link to the saved playlist.',
  },
  YT_UNKNOWN_KIND: {
    title: "we don't recognise that kind of playlist",
    body: 'ordinary playlists, albums and mixes all work.',
  },
  YT_UNSUPPORTED: {
    title: "that one can't be imported",
    body: 'try an ordinary playlist, album or mix link.',
  },
};

// ── Failures during the import ──────────────────────────────────────
export const IMPORT_ERRORS = {
  YT_NOT_FOUND: {
    title: "we couldn't find that playlist",
    body: 'it may have been deleted, or made private since the link was shared.',
    retryable: false,
  },
  YT_PRIVATE: {
    title: 'that playlist is private',
    body: 'in youtube, set it to unlisted or public, then try again.',
    retryable: true,
  },
  YT_QUOTA: {
    // Ours to fix, not theirs. Do not make this sound like their fault.
    title: 'imports are paused until tomorrow',
    body: "we've reached youtube's daily limit. nothing is lost — try again tomorrow.",
    retryable: false,
  },
  YT_TOO_LARGE: {
    title: 'that playlist is very large',
    body: 'import one with fewer than 1,000 songs for now.',
    retryable: false,
  },
  YT_TIMEOUT: {
    // Also raised client-side, by the deadline in api/ytImport.js — a poll that
    // never answers is the same story from the user's side as one youtube was
    // slow to serve, and it is retryable for the same reason.
    title: 'that took too long',
    body: 'try again in a moment.',
    retryable: true,
  },
  YT_UNREACHABLE: {
    title: "we couldn't reach youtube",
    body: 'check your connection and try again.',
    retryable: true,
  },
  YT_UPSTREAM: {
    title: 'youtube returned an error',
    body: 'try again in a few minutes.',
    retryable: true,
  },
  YT_USER_CAP: {
    title: "that's a lot of importing for one day",
    body: 'you can import more tomorrow.',
    retryable: false,
  },
  YT_GLOBAL_CAP: {
    title: 'imports are busy right now',
    body: 'try again in a little while.',
    retryable: true,
  },
  YT_DISABLED: {
    title: 'importing is not available right now',
    body: 'it will be back shortly.',
    retryable: false,
  },
  YT_INTERNAL: {
    title: 'something went wrong on our side',
    body: 'nothing was lost — try again.',
    retryable: true,
  },
  YT_NOT_OFFERED: {
    title: 'that suggestion is no longer available',
    body: 'pick another, or skip this one.',
    retryable: false,
  },
  YT_NOT_RUNNING: {
    title: 'that import has already finished',
    body: null,
    retryable: false,
  },
  YT_BAD_ID: {
    title: "we couldn't find that import",
    body: null,
    retryable: false,
  },
  YT_NO_LINK: {
    // Reached when a refresh is attempted on a playlist with no stored source —
    // most often one built from a mix, which regenerates every time youtube
    // makes it and so has nothing stable to refresh against.
    title: "there's nothing to refresh",
    body: "this playlist wasn't imported from a youtube playlist we can check again.",
    retryable: false,
  },
};

// ── The steady states ───────────────────────────────────────────────
export const COPY = {
  entry: {
    label: 'import from youtube',
    hint: "paste a playlist or mix link and we'll rebuild it here.",
  },

  paste: {
    placeholder: 'paste a youtube playlist or mix link',
    action: 'import',
    checking: 'checking that link…',
  },

  // Shown after /preview, before the user commits. This is where the honest
  // framing has to land, because afterwards it reads as an excuse.
  confirm: {
    playlist: n =>
      n
        ? `${n} songs. we'll find each one in aura.`
        : "we'll find each song in aura.",
    // A radio mix is not a fixed list. The same link returns different songs on
    // a later fetch — measured, twice — so "snapshot" is the literal truth and
    // the UI must not imply a sync it cannot deliver.
    mix: n =>
      `mixes don't have an end, so we'll take the first ${n} songs. this is a snapshot, not a live sync — the mix will change on youtube, and your playlist won't.`,
    action: 'import',
    cancel: 'cancel',
  },

  progress: {
    // The queued moment. There are no items yet — fetchPhase writes them all in
    // one transaction at the END of the fetch — so for this stretch the stage
    // line is genuinely the only thing there is to show.
    starting: 'starting…',
    fetching: 'reading the playlist…',
    // Progress must be countable. "finding songs — 12 of 30" is the only honest
    // progress indicator here, since per-song time varies by an order of
    // magnitude between a cache hit and a cold search.
    matching: (done, total) => `finding songs — ${done} of ${total}`,
    // Same count, different words, for the last few. Earned rather than
    // decorative: it is driven by the real remaining count, so a drain that
    // stalls at 28 of 30 sits on this line instead of easing toward a finish
    // that is not happening.
    almostThere: (done, total) => `almost there — ${done} of ${total}`,
    building: 'building your playlist…',
    // Rescoped from the web's "you can leave this screen". Native is the other
    // way round: the stack keeps parked screens MOUNTED, so opening another
    // screen keeps the poll — and therefore the import — running, and so does
    // backgrounding the app. What DOES stop it is backing out of this screen,
    // which is why that path asks first. The daily cron finishes whatever is
    // left either way.
    safeToLeave: "you can switch away — we'll keep going.",
    // Only reached at MAX_TICKS: the job is alive but has not moved for long
    // enough that something is wrong rather than slow.
    stalled: 'this is taking longer than it should.',
    resume: 'keep checking',
    // The rotating under-line.
    //
    // Advanced by the POLL, never by a clock, and that is what makes it honest.
    // The poll IS the server's worker — each GET performs a slice of the
    // matching — so an advancing word is evidence that work actually happened,
    // which is a stronger claim than any timer could make. A hung poll or a
    // stalled job freezes the word automatically, beside the note that explains
    // why, with no special case anywhere.
    //
    // The second half of the rule, which is what keeps it safe: every string in
    // a pool must be true of the WHOLE phase, for its whole duration. If one
    // were true only sometimes, then WHICH string is on screen becomes
    // information — and information delivered on a polling schedule is a lie
    // waiting to happen. So none of these counts, ranks, or estimates. The
    // countable claim stays on the line above, driven by real counts.
    words: {
      queued: ['lining this up', 'about to start reading'],
      fetching: [
        'asking youtube for the list',
        'reading the tracklist',
        'youtube sends these a page at a time',
        // Earns its place twice: it is true, and it explains why the song list
        // below is still empty — fetchPhase writes every item row in ONE
        // transaction at the end.
        'writing them all down at once',
      ],
      matching: [
        'looking this one up',
        'searching our catalogue',
        // These two quietly pre-teach the exact two facts the review screen
        // will later use to justify its candidates.
        'reading the title',
        'comparing what came back',
        'checking the length',
      ],
      closing: [
        'nearly through the list',
        'finishing the last few',
        'putting the playlist together',
      ],
    },
    // Spoken aloud rather than read as a bare numeral.
    elapsedLabel: 'time so far',
    // Per-song status in the live list. The drain resolves items strictly in
    // position order (matchPhase: ORDER BY position ASC LIMIT 1), so "the one
    // being worked on" is the first item with no tier yet — a fact about the
    // server's cursor, not a guess dressed up as one. That is what makes it
    // honest to name the song on screen.
    row: {
      working: 'matching…',
      matched: 'added',
      review: 'needs a check',
      missing: 'not in our catalogue',
    },
  },

  // The result summary. Ordered auto / review / missing, because that is
  // descending order of "already done for you".
  done: {
    ready: auto => `${auto} ${auto === 1 ? 'song' : 'songs'} added`,
    // ~35% of an import lands here. It is a normal part of the flow, so the
    // copy is an invitation, never an apology.
    review: n => `${n} to check — we found more than one possible match`,
    missing: n => `${n} not in our catalogue`,
    allAuto: 'every song matched. your playlist is ready.',
    nothingMatched:
      "we couldn't find any of these songs in our catalogue. nothing was added.",
    open: 'open playlist',
    reviewAction: 'check the rest',
    later: 'later',
    // The playlist already exists and already plays. This is the whole reason
    // for creating it before review rather than after.
    reassurance:
      'your playlist is ready to play now — checking the rest is optional.',
  },

  review: {
    title: 'which one is it?',
    progress: (done, total) => `${done} of ${total}`,
    // Naming what we read is what makes the choice explicable rather than
    // arbitrary: "A - B" is song-artist in Indian titles and artist-song in
    // Western ones, and the winning reading is shown for exactly that reason.
    readAs: (title, artist) =>
      artist
        ? `we read this as "${title}" by ${artist}`
        : `we read this as "${title}"`,
    onYouTube: 'on youtube',
    pick: "that's the one",
    skip: 'skip',
    skipAll: 'skip the rest',
    // Zero candidates. Not a failure the user can fix, and it must not look
    // like one: the catalogue genuinely cannot answer some queries, notably in
    // non-Latin scripts.
    none: "we couldn't find this one in our catalogue.",
    noneHint: "nothing to choose from here — it isn't something you did.",
    done: 'all checked',
    doneBody: 'your playlist is complete.',
  },

  // Re-import of a playlist already linked.
  refresh: {
    action: 'check for new songs',
    checking: 'checking youtube…',
    unchanged: 'nothing new — your playlist is up to date.',
    added: n => `${n} new ${n === 1 ? 'song' : 'songs'} added.`,
    // Refresh is deliberately not offered for mixes; if one is somehow reached,
    // this is the honest reason.
    notForMixes:
      "mixes change every time youtube generates them, so there's nothing stable to refresh against.",
  },

  cancel: {
    action: 'stop importing',
    confirm: 'stop this import?',
    // Cancelling does not delete what already arrived, and the user should know
    // that before they decide.
    body: 'songs already added will stay in your playlist.',
    keep: 'keep importing',
    stop: 'stop',
  },
};

/**
 * The message for a server error code, with a sane fallback.
 *
 * `serverMessage` is what the API sent. It is used only when the code is one
 * this build has never heard of — a client shipped before a server change still
 * says something specific rather than "something went wrong".
 */
export function copyForCode(code, serverMessage) {
  const hit = LINK_ERRORS[code] ?? IMPORT_ERRORS[code];
  if (hit) {
    return hit;
  }
  return {
    title: serverMessage || 'something went wrong',
    body: null,
    retryable: true,
  };
}

/** Is this code worth offering a retry button for? */
export function isRetryable(code) {
  return IMPORT_ERRORS[code]?.retryable === true;
}
