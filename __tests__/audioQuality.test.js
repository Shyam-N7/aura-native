import {
  QUALITIES,
  DEFAULT_QUALITY,
  getAudioQuality,
  setAudioQuality,
  subscribeAudioQuality,
  bitrateFor,
  hasBitrateToken,
  swapBitrate,
  qualityLadder,
} from '../src/lib/audioQuality';
import { storage } from '../src/storage/mmkv';

const URL_320 = 'https://cdn.example.com/track/abc_320.mp4';

beforeEach(() => {
  storage.removeItem('aura.audioQuality');
});

test('defaults to high and ignores garbage in storage', () => {
  expect(getAudioQuality()).toBe(DEFAULT_QUALITY);
  storage.setItem('aura.audioQuality', 'ultra');
  expect(getAudioQuality()).toBe(DEFAULT_QUALITY);
});

test('setAudioQuality persists valid ids and notifies subscribers', () => {
  const seen = [];
  const unsubscribe = subscribeAudioQuality(id => seen.push(id));

  setAudioQuality('low');
  expect(getAudioQuality()).toBe('low');
  setAudioQuality('ultra'); // invalid → ignored, no notification
  expect(getAudioQuality()).toBe('low');
  unsubscribe();
  setAudioQuality('normal');

  expect(seen).toEqual(['low']);
  expect(getAudioQuality()).toBe('normal');
});

test('bitrateFor maps every quality id (unknown falls back to first tier)', () => {
  for (const q of QUALITIES) {
    expect(bitrateFor(q.id)).toBe(q.bitrate);
  }
  expect(bitrateFor('nope')).toBe(QUALITIES[0].bitrate);
});

test('swapBitrate rewrites only the trailing bitrate token', () => {
  expect(swapBitrate(URL_320, 96)).toBe(
    'https://cdn.example.com/track/abc_96.mp4',
  );
  expect(swapBitrate('https://cdn/x_160.mp4?sig=1_2', 320)).toBe(
    'https://cdn/x_320.mp4?sig=1_2',
  );
  // Digits elsewhere in the path are untouched.
  expect(swapBitrate('https://cdn/v2/abc_48.mp4', 160)).toBe(
    'https://cdn/v2/abc_160.mp4',
  );
});

test('swapBitrate is a warn-once no-op without a token', () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const url = 'https://cdn/abc.mp4';
  expect(swapBitrate(url, 96)).toBe(url);
  expect(swapBitrate(url, 96)).toBe(url);
  expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
  warn.mockRestore();
});

test('hasBitrateToken detects the swappable suffix', () => {
  expect(hasBitrateToken(URL_320)).toBe(true);
  expect(hasBitrateToken('https://cdn/abc.mp4')).toBe(false);
  expect(hasBitrateToken(null)).toBe(false);
});

test('qualityLadder descends from the chosen bitrate, never above it', () => {
  expect(qualityLadder(URL_320, 320)).toEqual([
    'https://cdn.example.com/track/abc_320.mp4',
    'https://cdn.example.com/track/abc_160.mp4',
    'https://cdn.example.com/track/abc_96.mp4',
    'https://cdn.example.com/track/abc_48.mp4',
  ]);
  expect(qualityLadder(URL_320, 96)).toEqual([
    'https://cdn.example.com/track/abc_96.mp4',
    'https://cdn.example.com/track/abc_48.mp4',
  ]);
});

test('qualityLadder passes tokenless urls through as-is', () => {
  expect(qualityLadder('https://cdn/abc.mp4', 320)).toEqual([
    'https://cdn/abc.mp4',
  ]);
  expect(qualityLadder(null, 320)).toEqual([]);
});
