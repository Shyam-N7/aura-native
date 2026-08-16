import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { BackHandler } from 'react-native';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { Image } from 'react-native';
import { ImportJourney, sceneLayout } from '../src/components/yt/ImportJourney';
import { revealItem } from '../src/screens/YouTubeImportScreen';
import YouTubeImportScreen from '../src/screens/YouTubeImportScreen';
import { YouTubeReview } from '../src/overlays/YouTubeReview';
import PlaylistsScreen from '../src/screens/PlaylistsScreen';
import PlaylistScreen from '../src/screens/PlaylistScreen';
import {
  previewLink,
  startImport,
  cancelImport,
  pollImport,
  resolveItem,
  getFeatures,
  getYtLink,
  refreshPlaylist,
} from '../src/api/ytImport';
import { confirm } from '../src/lib/confirm';
import { showToast } from '../src/lib/toast';
import { COPY } from '../src/lib/ytImportCopy';
import {
  listPlaylists,
  listSavedPlaylists,
  getPlaylist,
} from '../src/api/playlists';
import { listAutoPlaylists } from '../src/api/autoPlaylists';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));
jest.mock('../src/api/ytImport', () => ({
  previewLink: jest.fn(),
  startImport: jest.fn(),
  cancelImport: jest.fn(),
  pollImport: jest.fn(),
  resolveItem: jest.fn(),
  getFeatures: jest.fn(),
  getYtLink: jest.fn(),
  refreshPlaylist: jest.fn(),
  invalidateYtLinks: jest.fn(),
  isLive: status => ['queued', 'fetching', 'matching'].includes(status),
}));
jest.mock('../src/lib/confirm', () => ({ confirm: jest.fn() }));
jest.mock('../src/lib/toast', () => ({ showToast: jest.fn() }));
jest.mock('../src/api/playlists', () => ({
  listPlaylists: jest.fn(),
  listSavedPlaylists: jest.fn(),
  createPlaylist: jest.fn(),
  deletePlaylist: jest.fn(),
  removePlaylistCollaborator: jest.fn(),
  getPlaylist: jest.fn(),
  getPublicPlaylist: jest.fn(),
  removeFromPlaylist: jest.fn(),
  getPlaylistRev: jest.fn(),
  createPlaylistInvite: jest.fn(),
  setPlaylistVisibility: jest.fn(),
  setPlaylistOnlyMe: jest.fn(),
  setPlaylistCover: jest.fn(),
  savePlaylist: jest.fn(),
  unsavePlaylist: jest.fn(),
}));
jest.mock('../src/api/autoPlaylists', () => ({ listAutoPlaylists: jest.fn() }));
jest.mock('../src/playback/PlayerContext', () => ({
  usePlayer: () => ({
    current: null,
    playQueue: jest.fn(),
    ui: { playerOpen: false, openPlayer: jest.fn() },
  }),
}));
jest.mock('../src/lib/auth', () => ({
  API_BASE: 'https://www.aurafm.live',
  getUser: () => ({ id: 'me', name: 'shyam' }),
  fetchAuthed: jest.fn(),
}));

function texts(node) {
  if (node == null) {
    return '';
  }
  if (typeof node === 'string') {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map(texts).join('');
  }
  return texts(node.children);
}
const byLabel = (tree, accessibilityLabel) =>
  tree.root.findAllByProps({ accessibilityLabel })[0];

async function render(node) {
  let tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
}
const flush = fn => ReactTestRenderer.act(async () => fn());

const nav = () => ({
  navigate: jest.fn(),
  replace: jest.fn(),
  goBack: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

async function typeUrl(tree, url) {
  await flush(() => byLabel(tree, COPY.paste.placeholder).props.onChangeText(url));
}

test('the link is checked after the debounce, not on every keystroke', async () => {
  previewLink.mockResolvedValue({ windowed: false });
  const tree = await render(<YouTubeImportScreen navigation={nav()} />);
  await typeUrl(tree, 'https://youtube.com/playlist?list=PL1');
  await flush(() => jest.advanceTimersByTime(349));
  expect(previewLink).not.toHaveBeenCalled();
  await flush(() => jest.advanceTimersByTime(1));
  expect(previewLink).toHaveBeenCalledTimes(1);
});

// The honest framing has to land BEFORE the user commits. Said afterwards it is
// an excuse: the same mix link returns different songs on a later fetch.
test('a mix says up front that it is a snapshot, not a sync', async () => {
  previewLink.mockResolvedValue({ windowed: true, windowSize: 100 });
  const tree = await render(<YouTubeImportScreen navigation={nav()} />);
  await typeUrl(tree, 'https://youtube.com/watch?v=x&list=RD1');
  await flush(() => jest.advanceTimersByTime(350));
  expect(texts(tree.toJSON())).toContain('snapshot, not a live sync');
});

test('a single-video link gets the copy written for it, not a generic apology', async () => {
  previewLink.mockRejectedValue(
    Object.assign(new Error('single video'), { code: 'YT_VIDEO_ONLY' }),
  );
  const tree = await render(<YouTubeImportScreen navigation={nav()} />);
  await typeUrl(tree, 'https://youtu.be/x');
  await flush(() => jest.advanceTimersByTime(350));
  const body = texts(tree.toJSON());
  expect(body).toContain("that's a single video");
  expect(body).toContain('open the playlist or mix it belongs to');
});

test('starting the import shows countable progress and says leaving is safe', async () => {
  previewLink.mockResolvedValue({ windowed: false });
  startImport.mockResolvedValue({
    id: 'yti_a',
    status: 'matching',
    counts: { total: 30, matching: 18 },
  });
  pollImport.mockResolvedValue({
    id: 'yti_a',
    status: 'matching',
    counts: { total: 30, matching: 18 },
  });
  const tree = await render(<YouTubeImportScreen navigation={nav()} />);
  await typeUrl(tree, 'https://youtube.com/playlist?list=PL1');
  await flush(() => jest.advanceTimersByTime(350));
  await flush(() => byLabel(tree, COPY.confirm.action).props.onPress());
  const body = texts(tree.toJSON());
  expect(body).toContain('finding songs — 12 of 30');
  expect(body).toContain(COPY.progress.safeToLeave);
});

// ── The live import screen ──────────────────────────────────────────

const item = (id, title, tier) => ({
  id,
  position: Number(id),
  youtube: { title, channel: 'c', durationSec: 200 },
  tier: tier ?? null,
  state: tier && tier !== 'review' ? 'done' : 'pending',
});

// 12 songs, the first 5 resolved — so the server's cursor is on #6.
const midImport = {
  id: 'yti_a',
  status: 'matching',
  counts: { total: 12, matching: 7, auto: 4, review: 1, unmatched: 0 },
  items: [
    item('1', 'first song', 'auto'),
    item('2', 'second song', 'auto'),
    item('3', 'third song', 'review'),
    item('4', 'fourth song', 'unmatched'),
    item('5', 'fifth song', 'auto'),
    item('6', 'sixth song'),
    item('7', 'seventh song'),
    item('8', 'eighth song'),
    item('9', 'ninth song'),
    item('10', 'tenth song'),
    item('11', 'eleventh song'),
    item('12', 'twelfth song'),
  ],
};

async function startWith(job) {
  previewLink.mockResolvedValue({ windowed: false });
  startImport.mockResolvedValue(job);
  pollImport.mockResolvedValue(job);
  const tree = await render(<YouTubeImportScreen navigation={nav()} />);
  await typeUrl(tree, 'https://youtube.com/playlist?list=PL1');
  await flush(() => jest.advanceTimersByTime(350));
  await flush(() => byLabel(tree, COPY.confirm.action).props.onPress());
  return tree;
}

test('the queued moment says starting — there are no items yet to show', async () => {
  const tree = await startWith({ id: 'yti_a', status: 'queued', counts: {} });
  const body = texts(tree.toJSON());
  expect(body).toContain(COPY.progress.starting);
  // fetchPhase writes every item row in one transaction at the END of the
  // fetch, so there is genuinely nothing to list yet.
  expect(body).not.toContain(COPY.progress.row.working);
});

test('the last few songs get their own line, driven by the real remaining count', async () => {
  const tree = await startWith({
    id: 'yti_a',
    status: 'matching',
    counts: { total: 30, matching: 2 },
    items: [],
  });
  expect(texts(tree.toJSON())).toContain(COPY.progress.almostThere(28, 30));
});

test('the live list names the song being matched and what happened to the rest', async () => {
  const tree = await startWith(midImport);
  const body = texts(tree.toJSON());

  // The frontier is the first item with no tier — the server drains strictly in
  // position order, so this is its actual cursor, not an estimate.
  expect(body).toContain('sixth song');
  expect(body).toContain(COPY.progress.row.working);
  // Each resolved tier wears its own outcome.
  expect(body).toContain(COPY.progress.row.matched);
  expect(body).toContain(COPY.progress.row.review);
  expect(body).toContain(COPY.progress.row.missing);
});

test('the window follows the work instead of showing the whole tracklist', async () => {
  const tree = await startWith(midImport);
  const body = texts(tree.toJSON());

  // 8 rows around the frontier: a few done above it, the rest waiting below.
  expect(body).toContain('third song');
  expect(body).toContain('sixth song');
  // Neither end of a 12-song import is on screen at once.
  expect(body).not.toContain('first song');
  expect(body).not.toContain('twelfth song');
});

test('a finished window does not fall off the end of the list', async () => {
  // Every item resolved — the frontier is past the last row, and the window
  // must clamp rather than slice past the end.
  const tree = await startWith({
    id: 'yti_a',
    status: 'matching',
    counts: { total: 3, matching: 0 },
    items: [item('1', 'a', 'auto'), item('2', 'b', 'auto'), item('3', 'c', 'auto')],
  });
  const body = texts(tree.toJSON());
  expect(body).toContain('a');
  expect(body).toContain('c');
  expect(body).not.toContain(COPY.progress.row.working);
});

// ── The rotating word, and the rule that keeps it honest ────────────

const wordsOnScreen = tree => {
  const body = texts(tree.toJSON());
  return Object.values(COPY.progress.words)
    .flat()
    .filter(w => body.includes(w));
};

test('the word advances on a POLL, because the poll is the work', async () => {
  const tree = await startWith(midImport);
  const before = wordsOnScreen(tree);
  expect(before).toHaveLength(1);
  expect(COPY.progress.words.matching).toContain(before[0]);

  // A DISTINCT object — the harness otherwise resolves the same reference every
  // tick, so setJob is a no-op and nothing turns.
  pollImport.mockResolvedValue({ ...midImport });
  await flush(() => jest.advanceTimersByTime(2000));
  const after = wordsOnScreen(tree);
  expect(after).toHaveLength(1);
  expect(after[0]).not.toBe(before[0]);
  expect(COPY.progress.words.matching).toContain(after[0]);
});

// The headline test. A word that kept cycling through a dead drain would be the
// decorative loader this whole screen exists to avoid.
test('a poll that never answers freezes the word', async () => {
  const tree = await startWith(midImport);
  const before = wordsOnScreen(tree);

  pollImport.mockRejectedValue(new Error('down'));
  await flush(() => jest.advanceTimersByTime(20000));

  expect(wordsOnScreen(tree)).toEqual(before);
  expect(texts(tree.toJSON())).toContain(COPY.progress.building);
});

test('each phase speaks only from its own vocabulary', async () => {
  let tree = await startWith({ id: 'yti_a', status: 'queued', counts: {}, items: [] });
  expect(COPY.progress.words.queued).toContain(wordsOnScreen(tree)[0]);

  tree = await startWith({
    id: 'yti_b', status: 'matching', counts: { total: 30, matching: 2 }, items: [],
  });
  expect(COPY.progress.words.closing).toContain(wordsOnScreen(tree)[0]);
});

// A pure data test, and the guard that stops someone adding "12 of 30 done" to
// a pool in two years. The countable claim belongs on the stage line, which is
// driven by real counts; the word must never carry one.
test('no rotating word ever claims progress', () => {
  for (const [phase, pool] of Object.entries(COPY.progress.words)) {
    for (const w of pool) {
      expect(`${phase}: ${w}`).not.toMatch(/\d/);
      expect(`${phase}: ${w}`).not.toMatch(/\bof\b/);
    }
  }
});

// ── Elapsed, and the house loader ───────────────────────────────────

test('the elapsed counter ticks, and is gone when the screen is', async () => {
  // Recomputed from a stored start rather than accumulated, so this is also
  // the assertion that backgrounding cannot make it drift.
  const setSpy = jest.spyOn(global, 'setInterval');
  const clearSpy = jest.spyOn(global, 'clearInterval');

  const tree = await startWith(midImport);
  await flush(() => jest.advanceTimersByTime(5000));
  expect(texts(tree.toJSON())).toContain('0:05');
  await flush(() => jest.advanceTimersByTime(60000));
  expect(texts(tree.toJSON())).toContain('1:05');

  // Every interval this screen opened is closed again. An uncancelled 1Hz
  // ticker on a screen the stack keeps mounted is the cheap version of exactly
  // the leak the animation gating exists to prevent.
  const opened = setSpy.mock.results.map(r => r.value);
  await ReactTestRenderer.act(async () => tree.unmount());
  const closed = clearSpy.mock.calls.map(c => c[0]);
  expect(opened.filter(id => !closed.includes(id))).toEqual([]);

  setSpy.mockRestore();
  clearSpy.mockRestore();
});

test('the journey scene carries the whole import, blank stretch included', async () => {
  // fetchPhase writes every item row in ONE transaction at the end, so until it
  // commits there is genuinely nothing to list — the scene (left mass breathing,
  // traveller wobbling) is what keeps that stretch from being an empty screen.
  let tree = await startWith({
    id: 'yti_a', status: 'fetching', counts: { total: 0 }, items: [],
  });
  expect(tree.root.findAllByType(ImportJourney)).toHaveLength(1);

  // And it stays as the centrepiece once the rows exist.
  tree = await startWith(midImport);
  expect(tree.root.findAllByType(ImportJourney)).toHaveLength(1);
  expect(texts(tree.toJSON())).toContain('sixth song');
});

// ── The scene's sizing is pure math, tested as math (Skia is mocked) ─

test('scene masses track the real counts and never vanish', () => {
  const empty = sceneLayout({});
  expect(empty.left.r).toBeGreaterThan(0);
  expect(empty.right.r).toBeGreaterThan(0);

  const mid = sceneLayout({ total: 30, matching: 20, auto: 8, review: 2 });
  const late = sceneLayout({ total: 30, matching: 2, auto: 26, review: 2 });
  // The story reads left-to-right: remaining shrinks, the playlist grows.
  expect(late.left.r).toBeLessThan(mid.left.r);
  expect(late.right.r).toBeGreaterThan(mid.right.r);
  expect(mid.review).toBe(2);
});

// ── The match reveal card: what the last song BECAME ────────────────

const resolvedWith = candidates => ({
  id: 'r1',
  position: 1,
  youtube: { title: 'Milana | Kannada Movie Video Song | HD', durationSec: 300 },
  tier: 'auto',
  state: 'done',
  candidates,
});

test('the reveal picks the newest resolved item that carries its winner', () => {
  const winner = { id: 'c1', title: 'Milana', artist: 'Sonu Nigam', imageUrl: 'https://x/150x150.jpg' };
  const items = [
    { ...resolvedWith([winner]), id: 'old', position: 0 },
    { ...resolvedWith([winner]), id: 'new', position: 1 },
    // A cache hit: resolved, but candidates:null — it cannot be shown, so the
    // card holds the newest row that CAN be, rather than a blank.
    { ...resolvedWith(null), id: 'cachehit', position: 2 },
    { id: 'pending', position: 3, tier: null, youtube: { title: 'next' } },
  ];
  expect(revealItem(items)?.id).toBe('new');
  // Nothing resolved with a winner yet → no card, not an empty shell.
  expect(revealItem([{ id: 'p', tier: null, youtube: {} }])).toBeNull();
});

test('the card shows the clean identity over the messy source title', async () => {
  const winner = { id: 'c1', title: 'Milana', artist: 'Sonu Nigam', imageUrl: 'https://x/150x150.jpg' };
  const tree = await startWith({
    ...midImport,
    items: [resolvedWith([winner]), { id: 'p2', position: 2, tier: null, youtube: { title: 'next up' } }],
  });
  const body = texts(tree.toJSON());
  expect(body).toContain(COPY.progress.found);
  expect(body).toContain('Milana');
  expect(body).toContain('Sonu Nigam');
  expect(body).toContain(COPY.progress.was('Milana | Kannada Movie Video Song | HD'));
});

test('a cache-hit import shows no card rather than an empty one', async () => {
  const tree = await startWith({
    ...midImport,
    items: [resolvedWith(null), { id: 'p2', position: 2, tier: null, youtube: { title: 'next' } }],
  });
  expect(texts(tree.toJSON())).not.toContain(COPY.progress.found);
});

test('the done payoff fans the matched covers', async () => {
  const winner = i => ({
    id: `c${i}`, title: `Song ${i}`, artist: 'A', imageUrl: `https://x/${i}_150x150.jpg`,
  });
  const tree = await startWith({
    id: 'yti_a',
    status: 'done',
    playlistId: 'p1',
    counts: { total: 3, auto: 3, review: 0, unmatched: 0, matching: 0 },
    items: [1, 2, 3].map(i => ({
      id: String(i), position: i, tier: 'auto', state: 'done',
      youtube: { title: `yt ${i}` }, candidates: [winner(i)],
    })),
  });
  const images = tree.root
    .findAllByType(Image)
    .filter(n => n.props.source?.uri?.includes('150x150'));
  expect(images.length).toBeGreaterThanOrEqual(3);
  // The canonical sentence survives as the a11y label while the numeral rolls.
  expect(texts(tree.toJSON())).toContain('songs added');
});

// On a stack screen the navigator owns back and would pop straight out — no
// confirm, no cancel — and popping unmounts the hook, which stops the drain
// with a once-a-day cron as the only recovery.
test('hardware back during a live import asks before stopping it', async () => {
  const handlers = [];
  const spy = jest
    .spyOn(BackHandler, 'addEventListener')
    .mockImplementation((_e, fn) => {
      handlers.push(fn);
      return { remove: jest.fn() };
    });
  previewLink.mockResolvedValue({ windowed: false });
  startImport.mockResolvedValue({
    id: 'yti_a',
    status: 'matching',
    counts: { total: 30, matching: 18 },
  });
  pollImport.mockResolvedValue({
    id: 'yti_a',
    status: 'matching',
    counts: { total: 30, matching: 18 },
  });
  confirm.mockResolvedValue(true);
  cancelImport.mockResolvedValue({ ok: true });
  const navigation = nav();

  const tree = await render(<YouTubeImportScreen navigation={navigation} />);
  await typeUrl(tree, 'https://youtube.com/playlist?list=PL1');
  await flush(() => jest.advanceTimersByTime(350));
  await flush(() => byLabel(tree, COPY.confirm.action).props.onPress());

  expect(handlers.length).toBeGreaterThan(0);
  await flush(() => expect(handlers[handlers.length - 1]()).toBe(true));

  expect(confirm).toHaveBeenCalledWith(
    expect.objectContaining({ action: COPY.cancel.stop, body: COPY.cancel.body }),
  );
  expect(cancelImport).toHaveBeenCalledWith('yti_a');
  expect(navigation.goBack).toHaveBeenCalled();
  spy.mockRestore();
});

test('a failed import offers retry only where retrying can change the answer', async () => {
  previewLink.mockResolvedValue({ windowed: false });
  startImport.mockResolvedValue({
    id: 'yti_a',
    status: 'failed',
    error: 'YT_QUOTA',
    counts: {},
  });
  const tree = await render(<YouTubeImportScreen navigation={nav()} />);
  await typeUrl(tree, 'https://youtube.com/playlist?list=PL1');
  await flush(() => jest.advanceTimersByTime(350));
  await flush(() => byLabel(tree, COPY.confirm.action).props.onPress());
  expect(texts(tree.toJSON())).toContain('imports are paused until tomorrow');
  expect(byLabel(tree, COPY.confirm.action)).toBeUndefined();
});

test('a finished import counts what landed and invites the rest', async () => {
  previewLink.mockResolvedValue({ windowed: false });
  startImport.mockResolvedValue({
    id: 'yti_a',
    status: 'done',
    playlistId: 'p1',
    counts: { total: 30, auto: 25, review: 3, unmatched: 2, matching: 0 },
  });
  const navigation = nav();
  const tree = await render(<YouTubeImportScreen navigation={navigation} />);
  await typeUrl(tree, 'https://youtube.com/playlist?list=PL1');
  await flush(() => jest.advanceTimersByTime(350));
  await flush(() => byLabel(tree, COPY.confirm.action).props.onPress());

  const body = texts(tree.toJSON());
  expect(body).toContain('25 songs added');
  expect(body).toContain('3 to check');
  expect(body).toContain('2 not in our catalogue');
  // The playlist already exists and already plays — that is the whole reason
  // for creating it before review rather than after.
  expect(body).toContain(COPY.done.reassurance);

  await flush(() => byLabel(tree, COPY.done.open).props.onPress());
  expect(navigation.replace).toHaveBeenCalledWith('Playlist', { id: 'p1' });
});

// ── Review ──────────────────────────────────────────────────────────

const reviewJob = {
  id: 'yti_a',
  playlistId: 'p1',
  items: [
    {
      id: '1',
      state: 'pending',
      tier: 'review',
      youtube: { title: 'Milana | Kannada Movie', channel: 'Anand', durationSec: 300 },
      candidates: [
        {
          id: 'c1',
          title: 'Milana',
          artist: 'Sonu Nigam',
          album: 'Milana',
          language: 'Kannada',
          durationSec: 312,
          reading: { title: 'Milana', artists: ['Sonu Nigam'] },
        },
        { id: 'c2', title: 'Milana Milana', artist: 'Someone', durationSec: 300 },
      ],
    },
    { id: '2', state: 'pending', tier: 'review', youtube: { title: 'B' }, candidates: [] },
    { id: '3', state: 'done', tier: 'unmatched', youtube: { title: 'C' } },
  ],
};

test('review explains the reading and the length drift, then records the choice', async () => {
  resolveItem.mockResolvedValue({ pending: 1, accepted: 1 });
  const tree = await render(
    <YouTubeReview job={reviewJob} onDone={jest.fn()} onOpenPlaylist={jest.fn()} />,
  );
  const body = texts(tree.toJSON());
  expect(body).toContain('1 of 2');
  // Naming the winning reading is what turns an arbitrary list into an
  // explicable one — "A - B" is song-artist here, artist-song in Western titles.
  expect(body).toContain('we read this as "Milana" by Sonu Nigam');
  // "12s longer" is a fact the user can act on; "0.83" is not.
  expect(body).toContain('12s longer');
  // The matcher deliberately sends same-title-different-language rows here, so
  // the language has to be visible or the question is unanswerable.
  expect(body).toContain('Kannada');

  await flush(() => byLabel(tree, 'Milana').props.onPress());
  expect(resolveItem).toHaveBeenCalledWith('yti_a', '1', { trackId: 'c1' });
  expect(texts(tree.toJSON())).toContain('2 of 2');
});

test('a row with nothing to choose from says it is not the user’s fault', async () => {
  resolveItem.mockResolvedValue({ pending: 0, accepted: 0 });
  const tree = await render(
    <YouTubeReview job={reviewJob} onDone={jest.fn()} onOpenPlaylist={jest.fn()} />,
  );
  await flush(() => byLabel(tree, COPY.review.skip).props.onPress());
  const body = texts(tree.toJSON());
  expect(body).toContain(COPY.review.none);
  expect(body).toContain(COPY.review.noneHint);
});

test('leaving review hands back a re-polled job so the summary is not stale', async () => {
  const onDone = jest.fn();
  pollImport.mockResolvedValue({ ...reviewJob, counts: { auto: 27 } });
  const tree = await render(
    <YouTubeReview job={reviewJob} onDone={onDone} onOpenPlaylist={jest.fn()} />,
  );
  await flush(() => byLabel(tree, COPY.review.skipAll).props.onPress());
  expect(pollImport).toHaveBeenCalledWith('yti_a');
  expect(onDone).toHaveBeenCalledWith(
    expect.objectContaining({ counts: { auto: 27 } }),
  );
});

// ── The entry point — the one gate that decides the feature exists ──

test('the import entry appears only where the deployment has the key', async () => {
  listPlaylists.mockResolvedValue([]);
  listSavedPlaylists.mockResolvedValue([]);
  listAutoPlaylists.mockResolvedValue([]);

  getFeatures.mockResolvedValue({});
  let tree = await render(<PlaylistsScreen navigation={nav()} />);
  expect(byLabel(tree, COPY.entry.label)).toBeUndefined();

  getFeatures.mockResolvedValue({ youtubeImport: true });
  const navigation = nav();
  tree = await render(<PlaylistsScreen navigation={navigation} />);
  await flush(() => byLabel(tree, COPY.entry.label).props.onPress());
  expect(navigation.navigate).toHaveBeenCalledWith('YouTubeImport');
});

// ── Refresh, on a playlist that has a source we can check again ─────

const PLAYLIST = {
  id: 'p1',
  name: 'Us',
  role: 'owner',
  canEdit: true,
  shared: false,
  isPublic: false,
  updatedAt: 1,
  ownerName: 'shyam',
  collaborators: [],
  tracks: [{ id: 't1', title: 'Song', artist: 'A', durationSec: 100 }],
};

async function renderDetail() {
  getPlaylist.mockResolvedValue(PLAYLIST);
  return render(
    <PlaylistScreen route={{ params: { id: 'p1' } }} navigation={nav()} />,
  );
}

// Absence of a link row IS the gate: the server writes one only for a finite
// playlist, never for a mix — a mix regenerates every time YouTube builds it,
// so there is nothing stable to diff against.
test('the refresh chip needs both the key and a stored source', async () => {
  getFeatures.mockResolvedValue({ youtubeImport: true });
  getYtLink.mockResolvedValue(null);
  let tree = await renderDetail();
  expect(byLabel(tree, COPY.refresh.action)).toBeUndefined();

  getFeatures.mockResolvedValue({});
  getYtLink.mockResolvedValue({ playlist_id: 'p1' });
  getYtLink.mockClear();
  tree = await renderDetail();
  expect(byLabel(tree, COPY.refresh.action)).toBeUndefined();
  // With the feature off we never even ask for the link — the chip could not
  // be rendered either way, and the request would be pure waste.
  expect(getYtLink).not.toHaveBeenCalled();

  getFeatures.mockResolvedValue({ youtubeImport: true });
  tree = await renderDetail();
  expect(byLabel(tree, COPY.refresh.action)).toBeDefined();
});

test('"nothing new" is the common answer, and it just says so', async () => {
  getFeatures.mockResolvedValue({ youtubeImport: true });
  getYtLink.mockResolvedValue({ playlist_id: 'p1' });
  refreshPlaylist.mockResolvedValue({ changed: false });
  const tree = await renderDetail();
  await flush(() => byLabel(tree, COPY.refresh.action).props.onPress());
  expect(showToast).toHaveBeenCalledWith(COPY.refresh.unchanged);
  expect(texts(tree.toJSON())).not.toContain(COPY.done.reviewAction);
});

test('a refresh with new songs drives the same job loop, then offers the review', async () => {
  getFeatures.mockResolvedValue({ youtubeImport: true });
  getYtLink.mockResolvedValue({ playlist_id: 'p1' });
  refreshPlaylist.mockResolvedValue({
    changed: true,
    id: 'yti_b',
    status: 'done',
    counts: { total: 4, auto: 3, review: 1, unmatched: 0, matching: 0 },
  });
  const tree = await renderDetail();
  await flush(() => byLabel(tree, COPY.refresh.action).props.onPress());
  expect(showToast).toHaveBeenCalledWith(COPY.refresh.added(3));
  // The playlist itself is re-read rather than patched — `load` already knows
  // both the owned and public shapes.
  expect(getPlaylist).toHaveBeenCalledTimes(2);
  expect(byLabel(tree, COPY.done.reviewAction)).toBeDefined();
});

test('a refresh on a mix explains why there is nothing to check', async () => {
  getFeatures.mockResolvedValue({ youtubeImport: true });
  getYtLink.mockResolvedValue({ playlist_id: 'p1' });
  refreshPlaylist.mockRejectedValue(
    Object.assign(new Error('no link'), { code: 'YT_NO_LINK' }),
  );
  const tree = await renderDetail();
  await flush(() => byLabel(tree, COPY.refresh.action).props.onPress());
  expect(showToast).toHaveBeenCalledWith("there's nothing to refresh");
});

// The stack keeps parked screens mounted, so without this the list comes back
// from a finished import missing the playlist it just created.
test('the playlists list refetches when it is focused again', async () => {
  listPlaylists.mockResolvedValue([]);
  listSavedPlaylists.mockResolvedValue([]);
  listAutoPlaylists.mockResolvedValue([]);
  getFeatures.mockResolvedValue({ youtubeImport: true });

  const navigation = nav();
  await render(<PlaylistsScreen navigation={navigation} />);
  const [, onFocus] = navigation.addListener.mock.calls[0];
  expect(listPlaylists).toHaveBeenCalledTimes(1);
  await flush(() => onFocus()); // the first fire is the mount itself
  expect(listPlaylists).toHaveBeenCalledTimes(1);
  await flush(() => onFocus());
  expect(listPlaylists).toHaveBeenCalledTimes(2);
});
