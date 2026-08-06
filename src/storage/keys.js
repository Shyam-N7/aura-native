// The MMKV keys that more than one module touches.
//
// Single-owner keys stay where they are owned — 'aura.theme' belongs to the
// theme, nobody else asks. These are the ones where a rename in the owning
// module compiles, passes, and quietly breaks a reader somewhere else:
//
//   queue / position   — written by PlayerContext, read by the progress seed
//                        (usePlaybackProgress), the presence heartbeat and
//                        the drift check. Four modules, three of them readers
//                        that fail SILENTLY: a stale key just looks like "no
//                        saved position", which is indistinguishable from a
//                        fresh install.
//   the sign-out purge — clearSession() in lib/auth deletes keys it does not
//                        own. That list is the whole of the account-switch
//                        boundary for stored data, and it was eight string
//                        literals retyped from eight other files.
//
// Values are the web app's localStorage keys verbatim; they are a persisted
// format, so changing one is a migration, not a rename.
export const K = {
  authToken: 'aura.authToken',
  authUser: 'aura.authUser',

  queue: 'aura.queue',
  position: 'aura.position',

  seedArtists: 'aura.seedArtists',
  seedLanguages: 'aura.seedLanguages',
  seedMood: 'aura.seedMood',

  talkHistory: 'aura.talkHistory',
  recentSearches: 'aura.recentSearches',
  privateUntil: 'aura.privateUntil',
};

// Everything clearSession() drops when a session ends. Named here rather than
// inline in auth.js so the list sits beside the keys it is made of: adding a
// per-account key to K without deciding whether it survives a sign-out is the
// mistake this is shaped to prevent.
//
// Not exhaustive by accident — it is exhaustive by review. Keys deliberately
// left OUT are device preferences, not account data: theme, ribbon style,
// gesture opt-outs, the push-permission stamp, the track cache.
export const SESSION_KEYS = [
  K.authToken,
  K.authUser,
  K.seedArtists,
  K.seedLanguages,
  K.seedMood,
  K.queue,
  K.position,
  K.talkHistory,
  K.recentSearches,
  // A private-listening window is one account's decision — a wall-clock
  // deadline left behind here silently suppressed the NEXT account's events,
  // impressions and presence for up to six hours.
  K.privateUntil,
];
