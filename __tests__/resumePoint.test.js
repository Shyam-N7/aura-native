import { resumeSec } from '../src/playback/resumePoint';

// The resume window lived twice — once deciding where playback actually
// resumes (PlayerContext.storedPositionSec), once deciding what the scrubber
// shows before the engine has a queue (usePlaybackProgress.readSeed) — in the
// same five conditions written in a different order. They agreed by
// coincidence. docs/CONTEXT.md called it a landmine; these pin the one
// definition both now read.

const track = { id: 't1', durationSec: 200 };

test('a mid-track position resumes at its second', () => {
  expect(resumeSec({ trackId: 't1', progress: 0.5 }, track)).toBe(100);
});

test('a snapshot for another track does not apply', () => {
  expect(resumeSec({ trackId: 'other', progress: 0.5 }, track)).toBe(null);
});

// Barely-started is not worth resuming, and nearly-over is better restarted
// than resumed two seconds from the outro.
test('the window excludes both ends', () => {
  expect(resumeSec({ trackId: 't1', progress: 0.01 }, track)).toBe(null);
  expect(resumeSec({ trackId: 't1', progress: 0.98 }, track)).toBe(null);
  expect(resumeSec({ trackId: 't1', progress: 0.011 }, track)).toBeCloseTo(2.2);
  expect(resumeSec({ trackId: 't1', progress: 0.979 }, track)).toBeCloseTo(195.8);
});

test('a track with no known duration cannot be resumed into', () => {
  expect(resumeSec({ trackId: 't1', progress: 0.5 }, { id: 't1' })).toBe(null);
  expect(
    resumeSec({ trackId: 't1', progress: 0.5 }, { id: 't1', durationSec: 0 }),
  ).toBe(null);
});

test('missing halves are not a resume point', () => {
  expect(resumeSec(null, track)).toBe(null);
  expect(resumeSec({ trackId: 't1', progress: 0.5 }, null)).toBe(null);
  expect(resumeSec(null, null)).toBe(null);
});

// The display seed and the playback start must answer identically for the same
// snapshot — that agreement is the entire reason this function exists.
test('one snapshot yields one answer for both readers', () => {
  const saved = { trackId: 't1', progress: 0.42 };

  const forPlayback = resumeSec(saved, track);
  const forDisplay = resumeSec(saved, track);

  expect(forPlayback).toBe(forDisplay);
  expect(forPlayback).toBeCloseTo(84);
});
