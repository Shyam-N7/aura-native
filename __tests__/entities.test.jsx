import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import ArtistScreen from '../src/screens/ArtistScreen';
import AlbumScreen from '../src/screens/AlbumScreen';
import LanguageHubScreen from '../src/screens/LanguageHubScreen';
import CatalogPlaylistScreen from '../src/screens/CatalogPlaylistScreen';
import { getArtist } from '../src/api/artists';
import { getAlbum } from '../src/api/catalog';
import { getDiscoverHome, getCatalogPlaylist } from '../src/api/discover';

const mockPlayQueue = jest.fn();
const mockPlayTrack = jest.fn();
const mockOpenPlayer = jest.fn();
jest.mock('../src/playback/PlayerContext', () => ({
  usePlayer: () => ({
    current: null,
    playQueue: mockPlayQueue,
    playTrack: mockPlayTrack,
    ui: { playerOpen: false, openPlayer: mockOpenPlayer },
  }),
}));
jest.mock('../src/api/artists', () => ({ getArtist: jest.fn() }));
jest.mock('../src/api/catalog', () => ({ getAlbum: jest.fn() }));
jest.mock('../src/api/discover', () => ({
  getDiscoverHome: jest.fn(),
  getCatalogPlaylist: jest.fn(),
}));

const TRACK = {
  id: 't1',
  title: 'Song',
  artist: 'A',
  album: 'Alb',
  language: 'tamil',
  durationSec: 100,
};
const TRACK2 = { ...TRACK, id: 't2', title: 'Other' };

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
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('artist: hero, top tracks, albums and similar all wired', async () => {
  getArtist.mockResolvedValue({
    id: 'a1',
    name: 'Sonu Nigam',
    image: null,
    bio: 'singer.',
    followerCount: 1200,
    topTracks: [TRACK],
    topAlbums: [{ id: 'al1', name: 'Great Album', image: null, year: '2020' }],
    similarArtists: [{ id: 's1', name: 'Other Artist', image: null }],
  });
  const navigation = { goBack: jest.fn(), push: jest.fn() };
  const tree = await render(
    <ArtistScreen route={{ params: { id: 'a1' } }} navigation={navigation} />,
  );

  const body = texts(tree.toJSON());
  expect(body).toContain('sonu nigam.');
  expect(body).toContain('fans');
  expect(body).toContain('Top tracks');
  expect(body).toContain('singer.');
  expect(getArtist).toHaveBeenCalledWith({ id: 'a1' }, expect.anything());

  byLabel(tree, 'play top tracks').props.onPress();
  expect(mockPlayQueue).toHaveBeenCalledWith(
    [TRACK],
    0,
    'sonu nigam · top tracks',
  );
  expect(mockOpenPlayer).toHaveBeenCalled();

  byLabel(tree, 'Great Album').props.onPress();
  expect(navigation.push).toHaveBeenCalledWith('Album', { id: 'al1' });
  byLabel(tree, 'Other Artist').props.onPress();
  expect(navigation.push).toHaveBeenCalledWith('Artist', {
    id: 's1',
    name: 'Other Artist',
  });

  await ReactTestRenderer.act(() => tree.unmount());
});

test('album: movie eyebrow, first artist only, rows play the sequence', async () => {
  getAlbum.mockResolvedValue({
    id: 'al1',
    name: 'Movie X',
    isMovie: true,
    artist: 'A, B',
    year: '2021',
    tracks: [TRACK, TRACK2],
  });
  const tree = await render(
    <AlbumScreen
      route={{ params: { id: 'al1' } }}
      navigation={{ goBack: jest.fn() }}
    />,
  );

  const body = texts(tree.toJSON());
  expect(body).toContain('movie');
  expect(body).toContain('Movie X');
  expect(body).toContain('By A');
  expect(body).not.toContain('by A, B');
  expect(body).toContain('2 tracks');

  byLabel(tree, 'play Other').props.onPress();
  expect(mockPlayQueue).toHaveBeenCalledWith([TRACK, TRACK2], 1, 'movie x');

  await ReactTestRenderer.act(() => tree.unmount());
});

// This screen mapped its whole tracklist into a plain ScrollView, mounting a
// TrackArt image per row with no cap from the server, while its three sibling
// detail screens all render through a windowed list. A long soundtrack paid for
// every row up front.
test('album: a long tracklist mounts windowed, not all at once', async () => {
  const many = Array.from({ length: 60 }, (_, i) => ({
    ...TRACK,
    id: `t${i}`,
    title: `Song ${i}`,
  }));
  getAlbum.mockResolvedValue({
    id: 'al2',
    name: 'Compilation',
    isMovie: false,
    artist: 'A',
    tracks: many,
  });

  const tree = await render(
    <AlbumScreen
      route={{ params: { id: 'al2' } }}
      navigation={{ goBack: jest.fn() }}
    />,
  );

  // Rows carry an accessibilityLabel of `play <title>`; count how many exist.
  const mounted = many.filter(
    tk => tree.root.findAllByProps({ accessibilityLabel: `play ${tk.title}` })
      .length > 0,
  ).length;

  // The header still renders from the full set...
  expect(texts(tree.toJSON())).toContain('60 tracks');
  // ...but the rows are windowed. Pre-fix this was all 60.
  expect(mounted).toBeGreaterThan(0);
  expect(mounted).toBeLessThan(many.length);

  await ReactTestRenderer.act(() => tree.unmount());
});

test('language hub: shelves render, tiles pick live or open playlists', async () => {
  getDiscoverHome.mockResolvedValue({
    trending: [TRACK],
    popularPlaylists: [
      { id: 'p1', name: 'Hits', coverImageUrl: null, subtitle: 'AURA' },
    ],
    topHits: [],
    classics: [],
    movieSongs: [],
  });
  const navigation = { goBack: jest.fn(), push: jest.fn() };
  const tree = await render(
    <LanguageHubScreen
      route={{ params: { lang: 'tamil' } }}
      navigation={navigation}
    />,
  );

  const body = texts(tree.toJSON());
  expect(body).toContain('tamil.');
  expect(body).toContain('Popular in Tamil right now');
  expect(body).toContain('— End of tamil —');

  byLabel(tree, 'Song').props.onPress();
  expect(mockPlayTrack).toHaveBeenCalledWith(TRACK, { source: 'your pick' });
  byLabel(tree, 'Hits').props.onPress();
  expect(navigation.push).toHaveBeenCalledWith('CatalogPlaylist', {
    id: 'p1',
  });

  await ReactTestRenderer.act(() => tree.unmount());
});

test('catalog playlist renders an auto mix from initialData with no fetch', async () => {
  const mix = {
    id: 'mix1',
    kind: 'auto',
    name: 'on repeat',
    editionLabel: 'tue 15 jul',
    description: 'what you loop',
    ruleLine: 'from your last 30 days',
    refreshing: false,
    tracks: [{ ...TRACK, reason: 'you looped this' }],
  };
  const tree = await render(
    <CatalogPlaylistScreen
      route={{ params: { initialData: mix } }}
      navigation={{ goBack: jest.fn() }}
    />,
  );

  expect(getCatalogPlaylist).not.toHaveBeenCalled();
  const body = texts(tree.toJSON());
  expect(body).toContain('on repeat.');
  expect(body).toContain('tue 15 jul');
  expect(body).toContain('you looped this');

  byLabel(tree, 'play all').props.onPress();
  expect(mockPlayQueue).toHaveBeenCalledWith(mix.tracks, 0, 'on repeat');
  expect(mockOpenPlayer).toHaveBeenCalled();

  await ReactTestRenderer.act(() => tree.unmount());
});
