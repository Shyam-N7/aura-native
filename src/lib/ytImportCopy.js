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
    title: 'Paste a link to start',
    body: 'Copy a YouTube playlist or mix link and paste it here.',
  },
  YT_NOT_A_URL: {
    title: "That doesn't look like a link",
    body: 'Paste the whole address, starting with youtube.com.',
  },
  YT_NOT_YOUTUBE: {
    title: 'That link is not from YouTube',
    body: 'Only YouTube playlists and mixes can be imported right now.',
  },
  YT_VIDEO_ONLY: {
    // The single most common mistake. The user pasted something real — say so,
    // rather than implying the link was junk.
    title: "That's a single video",
    body: 'Open the playlist or mix it belongs to, then copy that link instead.',
  },
  YT_NO_PLAYLIST: {
    title: "That link doesn't have a playlist in it",
    body: 'Open the playlist on YouTube and copy the link from there.',
  },
  YT_MALFORMED_ID: {
    title: 'That link is missing something',
    body: 'Try copying it again from YouTube.',
  },
  YT_WATCH_LATER: {
    // Worth being precise: users assume we are the ones refusing.
    title: 'Watch later cannot be read by any app',
    body: "Youtube keeps it private — not even YouTube's own apps can share it. Save the videos to a normal playlist and import that.",
  },
  YT_HISTORY: {
    title: 'Watch history stays private to YouTube',
    body: 'Make a playlist from the songs you want, then import that.',
  },
  YT_OAUTH_REQUIRED: {
    title: 'That playlist is tied to your YouTube account',
    body: 'In YouTube, set it to unlisted or public, then paste the link again.',
  },
  YT_NEEDS_SAVE: {
    // A user-seeded mix (RDMM/RDAMVM). Whether a server key can read these is
    // genuinely untested, so the copy gives the step that always works rather
    // than a claim we cannot stand behind.
    title: 'That mix was built for your account',
    body: 'Open it in YouTube, tap save, then paste the link to the saved playlist.',
  },
  YT_UNKNOWN_KIND: {
    title: "We don't recognise that kind of playlist",
    body: 'Ordinary playlists, albums and mixes all work.',
  },
  YT_UNSUPPORTED: {
    title: "That one can't be imported",
    body: 'Try an ordinary playlist, album or mix link.',
  },
};

// ── Failures during the import ──────────────────────────────────────
export const IMPORT_ERRORS = {
  YT_NOT_FOUND: {
    title: "We couldn't find that playlist",
    body: 'It may have been deleted, or made private since the link was shared.',
    retryable: false,
  },
  YT_PRIVATE: {
    title: 'That playlist is private',
    body: 'In YouTube, set it to unlisted or public, then try again.',
    retryable: true,
  },
  YT_QUOTA: {
    // Ours to fix, not theirs. Do not make this sound like their fault.
    title: 'Imports are paused until tomorrow',
    body: "We've reached YouTube's daily limit. Nothing is lost — try again tomorrow.",
    retryable: false,
  },
  YT_TOO_LARGE: {
    title: 'That playlist is very large',
    body: 'Import one with fewer than 1,000 songs for now.',
    retryable: false,
  },
  YT_TIMEOUT: {
    // Also raised client-side, by the deadline in api/ytImport.js — a poll that
    // never answers is the same story from the user's side as one youtube was
    // slow to serve, and it is retryable for the same reason.
    title: 'That took too long',
    body: 'Try again in a moment.',
    retryable: true,
  },
  YT_UNREACHABLE: {
    title: "We couldn't reach YouTube",
    body: 'Check your connection and try again.',
    retryable: true,
  },
  YT_UPSTREAM: {
    title: 'Youtube returned an error',
    body: 'Try again in a few minutes.',
    retryable: true,
  },
  YT_USER_CAP: {
    title: "That's a lot of importing for one day",
    body: 'You can import more tomorrow.',
    retryable: false,
  },
  YT_GLOBAL_CAP: {
    title: 'Imports are busy right now',
    body: 'Try again in a little while.',
    retryable: true,
  },
  YT_DISABLED: {
    title: 'Importing is not available right now',
    body: 'It will be back shortly.',
    retryable: false,
  },
  YT_MIGRATION: {
    // The deployed code is ahead of the database schema — a migration hasn't
    // run since a deploy. Distinct from YT_INTERNAL because retrying cannot
    // help, and each retry used to burn the daily import cap.
    title: 'The server needs a database update',
    body: "An update shipped but its database step hasn't run yet. Nothing was lost — imports resume the moment it does.",
    retryable: false,
  },
  YT_EXPIRED: {
    // The retention prune stopped a job that sat unfinished past the 30-day
    // window. The playlist keeps what arrived — cancel semantics, by time.
    title: 'That import never finished',
    body: 'It sat too long, so we stopped it. Everything already added is still in your playlist.',
    retryable: false,
  },
  YT_INTERNAL: {
    title: 'Something went wrong on our side',
    body: 'Nothing was lost — try again.',
    retryable: true,
  },
  YT_NOT_OFFERED: {
    title: 'That suggestion is no longer available',
    body: 'Pick another, or skip this one.',
    retryable: false,
  },
  YT_NOT_RUNNING: {
    title: 'That import has already finished',
    body: null,
    retryable: false,
  },
  YT_BAD_ID: {
    title: "We couldn't find that import",
    body: null,
    retryable: false,
  },
  YT_NO_LINK: {
    // Reached when a refresh is attempted on a playlist with no stored source —
    // most often one built from a mix, which regenerates every time youtube
    // makes it and so has nothing stable to refresh against.
    title: "There's nothing to refresh",
    body: "This playlist wasn't imported from a YouTube playlist we can check again.",
    retryable: false,
  },
};

// ── The steady states ───────────────────────────────────────────────
export const COPY = {
  entry: {
    label: 'Import from YouTube',
    hint: "Paste a playlist or mix link and we'll rebuild it here.",
  },

  paste: {
    placeholder: 'Paste a YouTube playlist or mix link',
    action: 'Import',
    checking: 'Checking that link…',
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
    // The research verdict, turned into guidance: a mix is generated per
    // request from the seed PLUS the requester's identity, so what we import
    // can never be the exact list the user's signed-in browser shows. The one
    // official path to what-you-see fidelity is YT Music's save-the-queue
    // flow — teach it instead of pretending.
    exactMixTitle: 'Want exactly your mix?',
    exactMixBody:
      "youtube builds mixes differently for every viewer, so an import can never match yours song-for-song. to capture exactly what you see: play the mix in the youtube music app, open up next, tap save, make it a new playlist — then paste that playlist's link here.",
    action: 'Import',
    cancel: 'Cancel',
  },

  progress: {
    // The queued moment. There are no items yet — fetchPhase writes them all in
    // one transaction at the END of the fetch — so for this stretch the stage
    // line is genuinely the only thing there is to show.
    starting: 'Starting…',
    fetching: 'Reading the playlist…',
    // Progress must be countable. "finding songs — 12 of 30" is the only honest
    // progress indicator here, since per-song time varies by an order of
    // magnitude between a cache hit and a cold search.
    matching: (done, total) => `finding songs — ${done} of ${total}`,
    // Same count, different words, for the last few. Earned rather than
    // decorative: it is driven by the real remaining count, so a drain that
    // stalls at 28 of 30 sits on this line instead of easing toward a finish
    // that is not happening.
    almostThere: (done, total) => `almost there — ${done} of ${total}`,
    building: 'Building your playlist…',
    // Rescoped from the web's "you can leave this screen". Native is the other
    // way round: the stack keeps parked screens MOUNTED, so opening another
    // screen keeps the poll — and therefore the import — running, and so does
    // backgrounding the app. What DOES stop it is backing out of this screen,
    // which is why that path asks first. The daily cron finishes whatever is
    // left either way.
    safeToLeave: "You can switch away — we'll keep going.",
    // Only reached at MAX_TICKS: the job is alive but has not moved for long
    // enough that something is wrong rather than slow.
    stalled: 'This is taking longer than it should.',
    resume: 'Keep checking',
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
    elapsedLabel: 'Time so far',
    // The match reveal card: what the last song BECAME. `found` is its
    // eyebrow; `was` shows the messy YouTube title underneath the clean
    // catalog identity — the before and after of the whole feature.
    found: 'Found',
    was: t => `was: ${t}`,
    // Per-song status in the live list. The drain resolves items strictly in
    // position order (matchPhase: ORDER BY position ASC LIMIT 1), so "the one
    // being worked on" is the first item with no tier yet — a fact about the
    // server's cursor, not a guess dressed up as one. That is what makes it
    // honest to name the song on screen.
    // Streaming handoff: the playlist exists mid-import (server creates it
    // after ~16 resolved) and these carry the user into it while the rest
    // streams in behind them.
    openNow: 'Open it now',
    openNowHint: 'The rest will keep arriving',
    autoOpen: 'Opening in a moment — tap to stay',
    cancelKeeps: 'Songs already added will stay in your playlist.',
    row: {
      working: 'Matching…',
      matched: 'Added',
      review: 'Needs a check',
      missing: 'Not in our catalogue',
    },
  },

  // The result summary. Ordered auto / review / missing, because that is
  // descending order of "already done for you".
  // The playlist-screen streaming tail: the footer under the last row while
  // songs are still arriving, and what it settles into when they stop.
  streaming: {
    footer: (n, total) => `adding the rest — ${n} of ${total}`,
    settled: n => `all ${n} in`,
    paused: 'Paused — tap to keep going',
    review: n => `${n} to check — whenever you like`,
    // The owned-mix payoff: an imported mix ends, and OUR radio keeps the
    // vibe going — stable and honest where youtube's tail is weather.
    radio: 'Keep it going — AURA radio from this mix',
  },
  done: {
    ready: auto => `${auto} ${auto === 1 ? 'song' : 'songs'} added`,
    // ~35% of an import lands here. It is a normal part of the flow, so the
    // copy is an invitation, never an apology.
    review: n => `${n} to check — we found more than one possible match`,
    missing: n => `${n} not in our catalogue`,
    allAuto: 'Every song matched. Your playlist is ready.',
    nothingMatched:
      "we couldn't find any of these songs in our catalogue. nothing was added.",
    open: 'Open playlist',
    reviewAction: 'Check the rest',
    later: 'Later',
    // The playlist already exists and already plays. This is the whole reason
    // for creating it before review rather than after.
    reassurance:
      'your playlist is ready to play now — checking the rest is optional.',
  },

  review: {
    title: 'Which one is it?',
    progress: (done, total) => `${done} of ${total}`,
    // Naming what we read is what makes the choice explicable rather than
    // arbitrary: "A - B" is song-artist in Indian titles and artist-song in
    // Western ones, and the winning reading is shown for exactly that reason.
    readAs: (title, artist) =>
      artist
        ? `we read this as "${title}" by ${artist}`
        : `we read this as "${title}"`,
    onYouTube: 'On YouTube',
    pick: "That's the one",
    skip: 'Skip',
    skipAll: 'Skip the rest',
    // Zero candidates. Not a failure the user can fix, and it must not look
    // like one: the catalogue genuinely cannot answer some queries, notably in
    // non-Latin scripts.
    none: "We couldn't find this one in our catalogue.",
    noneHint: "Nothing to choose from here — it isn't something you did.",
    done: 'All checked',
    doneBody: 'Your playlist is complete.',
  },

  // Re-import of a playlist already linked.
  refresh: {
    action: 'Check for new songs',
    checking: 'Checking YouTube…',
    unchanged: 'Nothing new — your playlist is up to date.',
    added: n => `${n} new ${n === 1 ? 'song' : 'songs'} added.`,
    // Refresh is deliberately not offered for mixes; if one is somehow reached,
    // this is the honest reason.
    notForMixes:
      "mixes change every time youtube generates them, so there's nothing stable to refresh against.",
  },

  cancel: {
    action: 'Stop importing',
    confirm: 'Stop this import?',
    // Cancelling does not delete what already arrived, and the user should know
    // that before they decide.
    body: 'Songs already added will stay in your playlist.',
    keep: 'Keep importing',
    stop: 'Stop',
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
