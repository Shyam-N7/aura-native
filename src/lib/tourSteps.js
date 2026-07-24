// Step definitions for the tap-through spotlight tours (lib/spotlightTour).
// A step is { target, title, body, open? }:
//  - target keys into the host screen's measured rect map; null = a centered
//    card (welcome / done, or things that only exist mid-playback).
//  - open names a You-screen shelf the host expands before measuring.
// Copy stays plain and warm — the onboarding voice, no jargon.

export const HOME_TOUR = {
  id: 'home',
  steps: [
    {
      target: null,
      title: 'welcome to aura',
      body: 'a quick look around — takes about a minute.',
    },
    {
      target: 'search',
      title: 'search',
      body: 'find any song, artist, or album — or just type a feeling.',
    },
    {
      target: 'bgToggle',
      title: 'background play',
      body: 'keep music playing after you close the app, or turn it off to save battery.',
    },
    {
      target: 'quickPicks',
      title: 'quick picks',
      body: 'a wheel of songs picked for you right now — tap one to start.',
    },
    {
      target: 'hero',
      title: "tonight's set",
      body: 'a ready-made set for the moment. tap begin to play it.',
    },
    {
      target: 'mixes',
      title: 'made for you',
      body: 'fresh mixes built from what you listen to, updated daily.',
    },
    {
      target: 'stations',
      title: 'stations & playlists',
      body: 'ready-made stations and popular playlists to dip into.',
    },
    {
      target: null,
      title: 'now playing',
      body: 'play something and it appears at the bottom — tap it for the full player.',
    },
    {
      target: null,
      title: "that's home",
      body: 'pull down to refresh anytime. enjoy the music.',
    },
  ],
};

// Settings tour — the admin step is only included for admins. Steps inside the
// settings shelf share the 'settingsShelf' anchor (the shelf is open by then);
// the copy is what changes per step.
export function buildSettingsTour({ admin = false } = {}) {
  const steps = [
    {
      target: null,
      title: 'this is you',
      body: 'your library and settings live here. quick tour?',
    },
    {
      target: 'duo',
      title: 'journal & sonic dna',
      body: 'a log of what you played, and the shape of your taste — genres and moods.',
    },
    {
      target: 'bridges',
      title: 'mood bridges',
      body: 'how your music moves from one feeling to another across a day.',
    },
    {
      target: 'shelves',
      open: 'liked',
      title: 'your library',
      body: 'liked songs, playlists, and history — all in one place.',
    },
    {
      target: 'shelves',
      open: 'languages',
      title: 'languages',
      body: 'pick the languages you want more of in your recommendations.',
    },
    {
      target: 'settingsShelf',
      collapse: true,
      title: 'tap to expand',
      body: 'every shelf opens like this — settings is the big one.',
    },
    {
      target: 'photo',
      open: 'settings',
      title: 'settings',
      body: 'your photo, the look, and everything below live here.',
    },
    {
      target: 'privateSession',
      open: 'settings',
      title: 'private session',
      body: 'listen without it shaping your recommendations or history.',
    },
    {
      target: 'familyMode',
      open: 'settings',
      title: 'family mode',
      body: 'keep it clean — filter explicit songs behind a PIN.',
    },
    {
      target: 'notifications',
      open: 'settings',
      title: 'notifications',
      body: 'choose what aura can nudge you about — mixes, activity, and more.',
    },
    ...(admin
      ? [
          {
            target: 'admin',
            open: 'settings',
            title: 'admin console',
            body: 'send a notification to yourself or everyone — your controls.',
          },
        ]
      : []),
    {
      target: null,
      title: "that's the tour",
      body: 'replay it anytime from settings. enjoy.',
    },
  ];
  return { id: 'settings', steps };
}
