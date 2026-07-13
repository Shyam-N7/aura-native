// Audio quality preference. Bitrate is just a suffix in the catalog CDN url
// (`..._96.mp4`, `..._320.mp4`), so we pick quality client-side by rewriting
// that suffix at playback time — no server round-trip, works on every track
// regardless of which endpoint produced it. Default is the highest tier.
// Verbatim port of web src/lib/audioQuality.js (storage backend swapped).
import { storage } from '../storage/mmkv';

const KEY = 'aura.audioQuality';
const subs = new Set();

// Lowest → highest is the order the picker renders; `high` is the default.
export const QUALITIES = [
  { id: 'high', bitrate: 320, label: 'high', caption: 'best sound · 320 kbps' },
  {
    id: 'normal',
    bitrate: 160,
    label: 'normal',
    caption: 'balanced · 160 kbps',
  },
  { id: 'low', bitrate: 96, label: 'low', caption: 'saves data · 96 kbps' },
];
export const DEFAULT_QUALITY = 'high';

const isValid = id => QUALITIES.some(q => q.id === id);

export function getAudioQuality() {
  const v = storage.getItem(KEY);
  if (isValid(v)) {
    return v;
  }
  return DEFAULT_QUALITY;
}
export function setAudioQuality(id) {
  if (!isValid(id)) {
    return;
  }
  storage.setItem(KEY, id);
  for (const cb of subs) {
    cb(id);
  }
}
export function subscribeAudioQuality(cb) {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function bitrateFor(id) {
  return (QUALITIES.find(q => q.id === id) ?? QUALITIES[0]).bitrate;
}

// The standard catalog tiers, highest first. 48 is the floor so a track that
// lacks every higher variant still plays rather than failing.
const STANDARD = [320, 160, 96, 48];

// Rewrite the bitrate suffix. Anchored to the `.mp4` filename extension (end
// of path or right before `?query`) so query strings and any other digits in
// the path are left alone. Returns the url unchanged when there's no token to
// swap.
const BITRATE_TOKEN = /_\d+\.mp4(?=\?|$)/;
// Whether a url carries a swappable bitrate suffix at all.
export function hasBitrateToken(url) {
  return !!url && BITRATE_TOKEN.test(url);
}
let warnedNoToken = false;
export function swapBitrate(url, bitrate) {
  if (!url) {
    return url;
  }
  // No swappable token → the chosen quality can't be applied and the url plays
  // at whatever bitrate the server baked in. Warn once so the drift is visible.
  if (!warnedNoToken && !BITRATE_TOKEN.test(url)) {
    warnedNoToken = true;
    console.warn(
      '[audioQuality] stream URL has no bitrate token — quality swap is a no-op:',
      url,
    );
  }
  return url.replace(BITRATE_TOKEN, `_${bitrate}.mp4`);
}

// Ordered urls to try for a chosen bitrate: the choice first, then descending
// fallbacks (never above the choice — respects "low" as a data-saver). A url
// with no swappable token can't be re-quality'd, so it's tried as-is.
export function qualityLadder(url, bitrate) {
  if (!url || !BITRATE_TOKEN.test(url)) {
    return url ? [url] : [];
  }
  const tiers = STANDARD.filter(b => b <= bitrate);
  const seen = new Set();
  const out = [];
  for (const b of tiers) {
    const u = swapBitrate(url, b);
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}
