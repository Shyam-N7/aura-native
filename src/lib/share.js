import { Share } from 'react-native';
import { API_BASE } from './auth';
import { cleanTitle } from '../utils/title';

// Share flows — a song, a moment in it, a lyric line — all as /t/ links the
// manifest verifies, so on a phone with AURA they open straight into the app
// and anywhere else they land on the web player with a proper preview card
// (the server's /t/:id OG route). The system share sheet carries its own
// copy/save actions, so there's nothing to build around it.

export function trackLink(id, atSec) {
  // src=share marks link-driven opens apart from typed URLs — the seed of
  // install/open attribution (AURA Command) without any tracker.
  const p = new URLSearchParams({ src: 'share' });
  if (Number.isFinite(atSec) && atSec > 0) {
    p.set('at', String(Math.floor(atSec)));
  }
  return `${API_BASE}/t/${encodeURIComponent(id)}?${p.toString()}`;
}

function stamp(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function credit(track) {
  const name = cleanTitle(track.title);
  return track.artist ? `${name} — ${track.artist}` : name;
}

async function open(message, title) {
  try {
    await Share.share({ title, message });
  } catch {
    // user dismissed the share sheet — nothing to do
  }
}

export function shareTrack(track) {
  if (!track?.id) {
    return Promise.resolve();
  }
  return open(
    `${credit(track)}\n${trackLink(track.id)}`,
    cleanTitle(track.title),
  );
}

// A timestamped link — opens the song right at this second.
export function shareMoment(track, sec) {
  if (!track?.id) {
    return Promise.resolve();
  }
  return open(
    `${credit(track)} — from ${stamp(sec)}\n${trackLink(track.id, sec)}`,
    cleanTitle(track.title),
  );
}

export function shareLyric(track, line) {
  if (!track?.id || !line) {
    return Promise.resolve();
  }
  return open(
    `"${line}"\n${credit(track)}\n${trackLink(track.id)}`,
    cleanTitle(track.title),
  );
}
