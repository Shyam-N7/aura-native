import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import PlaylistsScreen from '../src/screens/PlaylistsScreen';
import PlaylistScreen from '../src/screens/PlaylistScreen';
import {
  listPlaylists,
  listSavedPlaylists,
  getPlaylist,
  deletePlaylist,
} from '../src/api/playlists';
import { listAutoPlaylists } from '../src/api/autoPlaylists';

// The rev-poll's focus gate — these tests render bare (no NavigationContainer),
// so give the hook a constant answer.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));

const mockPlayQueue = jest.fn();
const mockOpenPlayer = jest.fn();
jest.mock('../src/playback/PlayerContext', () => ({
  usePlayer: () => ({
    current: null,
    playQueue: mockPlayQueue,
    ui: { playerOpen: false, openPlayer: mockOpenPlayer },
  }),
}));
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
// The streaming tail drives the real useImportJob hook; only the wire is
// mocked. isLive is the real predicate — the loop's stop condition is under
// test and must not be stubbed into agreement.
jest.mock('../src/api/ytImport', () => ({
  getFeatures: jest.fn(() => Promise.resolve({})),
  getYtLink: jest.fn(() => Promise.resolve(null)),
  refreshPlaylist: jest.fn(),
  pollImport: jest.fn(),
  invalidateYtLinks: jest.fn(),
  isLive: status => ['queued', 'fetching', 'matching'].includes(status),
}));
// The review overlay is its own tested surface; here it only needs to exist.
jest.mock('../src/overlays/YouTubeReview', () => ({
  YouTubeReview: () => null,
}));
// The real confirm() publishes to a sheet mounted in App; nothing renders it
// here, so the promise would hang and the delete flow with it.
jest.mock('../src/lib/confirm', () => ({ confirm: jest.fn() }));
jest.mock('../src/lib/auth', () => ({
  getModeEpoch: () => 0,
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

beforeEach(() => jest.clearAllMocks());

test('playlists library groups yours, shared-with-you and saved', async () => {
  listPlaylists.mockResolvedValue([
    { id: 'p1', name: 'Drive', trackCount: 3, shared: false, role: 'owner' },
    {
      id: 'p2',
      name: 'Us',
      trackCount: 5,
      shared: true,
      role: 'editor',
      updatedAt: Date.now(),
    },
  ]);
  listSavedPlaylists.mockResolvedValue([
    { id: 'p3', name: 'Kept', trackCount: 2, accessible: true, ownerName: 'ann' },
  ]);
  listAutoPlaylists.mockResolvedValue([]);

  const navigate = jest.fn();
  const tree = await render(
    <PlaylistsScreen
      navigation={{
        navigate,
        goBack: jest.fn(),
        // The screen refetches on focus (the stack keeps it mounted, so a
        // playlist created elsewhere would otherwise never appear); the stub
        // needs the listener the real navigation object always has.
        addListener: jest.fn(() => jest.fn()),
      }}
    />,
  );

  const body = texts(tree.toJSON());
  expect(body).toContain('made by you');
  expect(body).toContain('shared with you');
  expect(body).toContain('saved');
  expect(body).toContain('Drive');
  expect(body).toContain('shared with you');
  expect(body).toContain('by ann');

  byLabel(tree, 'Drive').props.onPress();
  expect(navigate).toHaveBeenCalledWith('Playlist', { id: 'p1' });
  // The ⋯ opens a MENU now, per the field report: it used to go straight to
  // the confirm sheet, which therefore read as a menu — and its red "delete"
  // pill read as choosing an action, not answering a question.
  expect(byLabel(tree, 'Drive options')).toBeTruthy();
  expect(byLabel(tree, 'Us options')).toBeTruthy();

  await ReactTestRenderer.act(() => tree.unmount());
});

test('deleting a playlist is two steps: a menu, then a question', async () => {
  listPlaylists.mockResolvedValue([
    { id: 'p1', name: 'Drive', trackCount: 3, updatedAt: Date.now() },
    {
      id: 'p2', name: 'Us', trackCount: 5, shared: true, role: 'editor',
      updatedAt: Date.now(),
    },
  ]);
  listSavedPlaylists.mockResolvedValue([]);
  listAutoPlaylists.mockResolvedValue([]);

  const tree = await render(
    <PlaylistsScreen
      navigation={{
        navigate: jest.fn(),
        goBack: jest.fn(),
        addListener: jest.fn(() => jest.fn()),
      }}
    />,
  );

  // Step one: the dots open the popup — the playlist's details as the
  // header, actions under it. Nothing is asked, nothing is deleted.
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'Drive options').props.onPress();
  });
  expect(texts(tree.toJSON())).toContain('open playlist');
  expect(deletePlaylist).not.toHaveBeenCalled();

  // Step two: the danger row raises the ConfirmPopup question — same popup
  // family as the menu, not the global sheet. Cancelling deletes nothing.
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'delete playlist').props.onPress();
  });
  expect(texts(tree.toJSON())).toContain('delete "Drive"?');
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'cancel').props.onPress();
  });
  expect(deletePlaylist).not.toHaveBeenCalled();

  // Accepting deletes.
  deletePlaylist.mockResolvedValueOnce({});
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'Drive options').props.onPress();
  });
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'delete playlist').props.onPress();
  });
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'delete').props.onPress();
  });
  expect(deletePlaylist).toHaveBeenCalledWith('p1');

  // A collaborator's menu offers leave, not delete.
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'Us options').props.onPress();
  });
  expect(byLabel(tree, 'leave playlist')).toBeTruthy();

  await ReactTestRenderer.act(() => tree.unmount());
});

test('playlist detail shows hero, share chip, added-by and row actions', async () => {
  getPlaylist.mockResolvedValue({
    id: 'p1',
    name: 'Us',
    role: 'owner',
    canEdit: true,
    shared: true,
    isPublic: false,
    updatedAt: Date.now(),
    ownerName: 'shyam',
    collaborators: [
      { userId: 'u2', name: 'ann', role: 'editor', joinedAt: Date.now() },
    ],
    tracks: [
      {
        id: 't1',
        title: 'Song',
        artist: 'A',
        language: 'tamil',
        durationSec: 100,
        addedBy: { userId: 'u2', name: 'ann' },
      },
    ],
  });

  const tree = await render(
    <PlaylistScreen
      route={{ params: { id: 'p1' } }}
      navigation={{ goBack: jest.fn() }}
    />,
  );

  const body = texts(tree.toJSON());
  expect(body).toContain('Us');
  expect(body).toContain('by you');
  expect(body).toContain('added by ann');
  expect(body).toContain('shared');

  // The share chip wears the reach; opening it lists the three states.
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'shared — change who can see this').props.onPress();
  });
  const sheet = texts(tree.toJSON());
  expect(sheet).toContain('who can see this');
  expect(sheet).toContain('only you');
  expect(sheet).toContain('make a public view link');

  await ReactTestRenderer.act(() => tree.unmount());
});


test('the streaming handoff: footer counts up, rows refetch, review takes over', async () => {
  jest.useFakeTimers();
  const { pollImport } = require('../src/api/ytImport');
  const { COPY: YT } = require('../src/lib/ytImportCopy');

  const playlistOf = n => ({
    id: 'p9', name: 'Trip', shared: false, canEdit: true, isPublic: false,
    updatedAt: 1, collaborators: [],
    tracks: Array.from({ length: n }, (_, i) => ({
      id: `t${i}`, title: `Song ${i}`, artist: 'A', language: 'ta',
    })),
  });
  // Paired to the flow: the initial load, then one refetch per poll that
  // landed songs (the poll's counts trigger it), then the terminal refetch.
  getPlaylist
    .mockResolvedValueOnce(playlistOf(16))
    .mockResolvedValueOnce(playlistOf(16))
    .mockResolvedValueOnce(playlistOf(24))
    .mockResolvedValue(playlistOf(58));
  const liveCounts = (auto, matching) => ({
    total: 60, auto, review: 0, unmatched: 0, matching,
  });
  pollImport
    .mockResolvedValueOnce({
      id: 'yti_9', status: 'matching', playlistId: 'p9',
      counts: liveCounts(16, 44), items: [],
    })
    .mockResolvedValueOnce({
      id: 'yti_9', status: 'matching', playlistId: 'p9',
      counts: liveCounts(24, 36), items: [],
    })
    .mockResolvedValue({
      id: 'yti_9', status: 'ready', playlistId: 'p9',
      counts: { total: 60, auto: 55, review: 3, unmatched: 2, matching: 0 },
      items: [],
    });

  const setParams = jest.fn();
  const tree = await render(
    <PlaylistScreen
      route={{ params: { id: 'p9', importJobId: 'yti_9' } }}
      navigation={{ goBack: jest.fn(), setParams, addListener: jest.fn(() => jest.fn()) }}
    />,
  );
  // Bare seed → immediate first poll; the param is consumed exactly once.
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(0);
  });
  expect(pollImport).toHaveBeenCalledTimes(1);
  expect(setParams).toHaveBeenCalledWith({ importJobId: undefined });
  expect(texts(tree.toJSON())).toContain(YT.streaming.footer(16, 60));

  // Next poll lands more songs: the playlist refetches, the footer counts up.
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(2000);
  });
  await ReactTestRenderer.act(async () => {});
  expect(texts(tree.toJSON())).toContain(YT.streaming.footer(24, 60));

  // Terminal with review left: the footer becomes the review entry.
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(2000);
  });
  await ReactTestRenderer.act(async () => {});
  expect(texts(tree.toJSON())).toContain(YT.streaming.review(3));

  // Entering review retires the chip (the overlay owns the screen now).
  await ReactTestRenderer.act(async () => {
    byLabel(tree, YT.streaming.review(3)).props.onPress();
  });
  expect(texts(tree.toJSON())).not.toContain(YT.streaming.review(3));

  await ReactTestRenderer.act(() => tree.unmount());
  jest.useRealTimers();
});

test('without the handoff param the playlist screen is inert — no footer, no polls', async () => {
  const { pollImport } = require('../src/api/ytImport');
  const { COPY: YT } = require('../src/lib/ytImportCopy');
  getPlaylist.mockResolvedValue({
    id: 'p1', name: 'Quiet', shared: false, canEdit: true, isPublic: false,
    updatedAt: 1, collaborators: [],
    tracks: [{ id: 't1', title: 'One', artist: 'A', language: 'ta' }],
  });
  const tree = await render(
    <PlaylistScreen
      route={{ params: { id: 'p1' } }}
      navigation={{ goBack: jest.fn(), setParams: jest.fn(), addListener: jest.fn(() => jest.fn()) }}
    />,
  );
  expect(pollImport).not.toHaveBeenCalled();
  expect(texts(tree.toJSON())).not.toContain(YT.streaming.footer(1, 1));
  await ReactTestRenderer.act(() => tree.unmount());
});
