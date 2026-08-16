import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import PlaylistsScreen from '../src/screens/PlaylistsScreen';
import PlaylistScreen from '../src/screens/PlaylistScreen';
import {
  listPlaylists,
  listSavedPlaylists,
  getPlaylist,
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
  // Owner rows delete; joined rows leave.
  expect(byLabel(tree, 'delete Drive')).toBeTruthy();
  expect(byLabel(tree, 'leave Us')).toBeTruthy();

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
