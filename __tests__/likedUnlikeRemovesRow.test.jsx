import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';

// Unliking a song must remove its row from Liked. That is the screen's whole
// contract — its own header comment says "numbered rows with a heart that
// drops the row on unlike".
//
// It stopped doing that, and the cause is worth stating because it is subtle:
// the row filter was a render-body expression, and moving it into a useMemo
// froze it. The deps were [data, ready, isLiked], justified by a comment saying
// isLiked's identity "never changes, so these deps are honest". That is
// backwards — an identity that never changes can never signal that the SET
// changed. `data` is written once by the fetch effect, `ready` only moves at
// boot, so nothing moved on an unlike: the memo returned its cached array, the
// row stayed, the heart went hollow, and CountLine kept counting it.
//
// This test goes through the real useLikes store and the real screen, because
// the bug lives precisely in the wiring between them. Mocking either end would
// have let it through.

jest.mock('../src/api/likes', () => ({
  listLiked: jest.fn(),
  // The hook boots from listLikedIds — not getLikedIds. Getting that wrong
  // makes the store boot empty and `ready` hide every row, which fails the
  // test for a reason that has nothing to do with the bug.
  listLikedIds: jest.fn(() => Promise.resolve(['a', 'b'])),
  likeTrack: jest.fn(() => Promise.resolve()),
  unlikeTrack: jest.fn(() => Promise.resolve()),
}));

jest.mock('../src/playback/PlayerContext', () => ({
  usePlayer: () => ({ playQueue: jest.fn(), ui: { openPlayer: jest.fn() } }),
}));

const track = id => ({
  id,
  title: `song ${id}`,
  artist: 'someone',
  language: 'tamil',
  durationSec: 100,
});

const { listLiked } = require('../src/api/likes');
const { resetLikesStore, useLikes } = require('../src/hooks/useLikes');
const { resetRenderCounts } = require('../src/lib/renderCount');
const LikedScreen = require('../src/screens/LikedScreen').default;

// Read the row titles the screen is actually showing.
const titles = tree =>
  tree.root
    .findAllByType('Text')
    .map(n => (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children))
    .filter(s => typeof s === 'string' && s.startsWith('song '));

describe('unliking removes the row', () => {
  beforeEach(() => {
    resetLikesStore?.();
    // The __DEV__ render tally arms a 2.5s timer; left running it logs after
    // the suite finishes.
    resetRenderCounts();
    listLiked.mockResolvedValue([track('a'), track('b')]);
  });

  test('the row disappears when the track is unliked', async () => {
    let api = null;
    const Probe = () => {
      api = useLikes();
      return null;
    };

    let tree;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <Probe />
          <LikedScreen navigation={{ goBack: jest.fn() }} />
        </ThemeProvider>,
      );
    });

    expect(titles(tree).sort()).toEqual(['song a', 'song b']);

    await ReactTestRenderer.act(async () => {
      await api.unlike('a');
    });

    // Before the fix this returned both rows: the memo never recomputed, so
    // the screen kept rendering a song the user had just unliked.
    expect(titles(tree)).toEqual(['song b']);

    await ReactTestRenderer.act(() => tree.unmount());
    resetRenderCounts();
  });
});
