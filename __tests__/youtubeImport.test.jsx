import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { BackHandler } from 'react-native';
import { ThemeProvider } from '../src/theme/ThemeContext';
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
