import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { RefreshControl } from 'react-native';
import { ThemeProvider } from '../src/theme/ThemeContext';

// Pull-to-refresh, proved where it can actually lie.
//
// A refresh control is easy to render and easy to get wrong in exactly two
// ways, and both of them LOOK fine in a screenshot:
//
//  1. the spinner is wired to a timer (or to nothing) instead of to the
//     screen's real refetch — it spins, it stops, and the data is the same;
//  2. the flag never clears when the request FAILS — one lost connection and
//     the list wears a spinner forever, over rows that are perfectly fine.
//
// So these go through the real screens and the real usePullRefresh: the pull
// is fired the way the scroller fires it (the RefreshControl's own onRefresh),
// and the assertions are on the API mock's call count and on the control's
// `refreshing` prop, before and after the promise settles.

jest.mock('../src/api/likes', () => ({
  listLiked: jest.fn(),
  // The like-store boots from this; until it is ready LikedScreen hides every
  // row it cannot find in the set, so these must cover the fixtures below.
  listLikedIds: jest.fn(() => Promise.resolve(['a', 'b', 'c'])),
  likeTrack: jest.fn(() => Promise.resolve()),
  unlikeTrack: jest.fn(() => Promise.resolve()),
}));

jest.mock('../src/api/stats', () => ({
  getHistory: jest.fn(),
  getMusicClockPlays: jest.fn(() => Promise.resolve([])),
}));

jest.mock('../src/playback/PlayerContext', () => ({
  usePlayer: () => ({
    playQueue: jest.fn(),
    playTrack: jest.fn(),
    ui: { openPlayer: jest.fn() },
  }),
}));

const { listLiked } = require('../src/api/likes');
const { getHistory } = require('../src/api/stats');
const { resetLikesStore } = require('../src/hooks/useLikes');
const { resetRenderCounts } = require('../src/lib/renderCount');
const { subscribeToast } = require('../src/lib/toast');
const { REFRESH_FAILED } = require('../src/hooks/usePullRefresh');
const LikedScreen = require('../src/screens/LikedScreen').default;
const HistoryScreen = require('../src/screens/HistoryScreen').default;

const track = (id, title) => ({
  id,
  title: title ?? `song ${id}`,
  artist: 'someone',
  language: 'tamil',
  durationSec: 100,
});

const nav = { goBack: jest.fn(), addListener: jest.fn(() => () => {}) };

// Every row title the screen is actually showing.
const titles = tree =>
  tree.root
    .findAllByType('Text')
    .map(n =>
      Array.isArray(n.props.children)
        ? n.props.children.join('')
        : n.props.children,
    )
    .filter(s => typeof s === 'string' && s.startsWith('song '));

const control = tree => tree.root.findByType(RefreshControl);

// A promise this test decides when to settle, so `refreshing` can be read
// WHILE the refetch is in flight — the half a timer-driven spinner fakes.
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const mount = async node => {
  let tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
};

describe('pull to refresh', () => {
  beforeEach(() => {
    resetLikesStore?.();
    // The __DEV__ render tally arms a 2.5s timer; left running it logs after
    // the suite finishes.
    resetRenderCounts();
    jest.clearAllMocks();
  });

  test('the pull re-runs the screen’s real fetch, and the flag clears when it lands', async () => {
    listLiked.mockResolvedValueOnce([track('a')]);
    const tree = await mount(<LikedScreen navigation={nav} />);

    expect(listLiked).toHaveBeenCalledTimes(1);
    expect(titles(tree)).toEqual(['song a']);
    expect(control(tree).props.refreshing).toBe(false);

    // The second answer is DIFFERENT, so a spinner that only spins can't pass.
    const second = deferred();
    listLiked.mockReturnValueOnce(second.promise);

    await ReactTestRenderer.act(async () => {
      control(tree).props.onRefresh();
    });
    expect(listLiked).toHaveBeenCalledTimes(2);
    // In flight: the spinner is up and the old rows are still on screen —
    // a refresh does not blank the list it is refreshing.
    expect(control(tree).props.refreshing).toBe(true);
    expect(titles(tree)).toEqual(['song a']);

    await ReactTestRenderer.act(async () => {
      second.resolve([track('a'), track('b')]);
      await second.promise;
    });
    expect(control(tree).props.refreshing).toBe(false);
    expect(titles(tree)).toEqual(['song a', 'song b']);
  });

  test('a refresh that FAILS clears the flag, keeps the rows, and says so once', async () => {
    listLiked.mockResolvedValueOnce([track('a')]);
    const tree = await mount(<LikedScreen navigation={nav} />);
    expect(titles(tree)).toEqual(['song a']);

    const said = [];
    const off = subscribeToast(e => said.push(e.message));

    const second = deferred();
    listLiked.mockReturnValueOnce(second.promise);
    await ReactTestRenderer.act(async () => {
      control(tree).props.onRefresh();
    });
    expect(control(tree).props.refreshing).toBe(true);

    await ReactTestRenderer.act(async () => {
      second.reject(new Error('network down'));
      await second.promise.catch(() => {});
    });

    // The three things a failed refresh owes: no stuck spinner, no error page
    // where a good list used to be, and one sentence about it.
    expect(control(tree).props.refreshing).toBe(false);
    expect(titles(tree)).toEqual(['song a']);
    expect(said).toEqual([REFRESH_FAILED]);
    off();
  });

  test('a pull while one is already running is a no-op', async () => {
    listLiked.mockResolvedValueOnce([track('a')]);
    const tree = await mount(<LikedScreen navigation={nav} />);

    const second = deferred();
    listLiked.mockReturnValueOnce(second.promise);
    await ReactTestRenderer.act(async () => {
      control(tree).props.onRefresh();
      control(tree).props.onRefresh();
      control(tree).props.onRefresh();
    });
    // One request, not three racing to write the same state.
    expect(listLiked).toHaveBeenCalledTimes(2);

    await ReactTestRenderer.act(async () => {
      second.resolve([track('a')]);
      await second.promise;
    });
    expect(control(tree).props.refreshing).toBe(false);
  });

  test('the spinner wears each theme, not the stock white disc', async () => {
    const { themes } = require('../src/theme/tokens');
    const { storage } = require('../src/storage/mmkv');
    for (const name of ['dusk', 'midnight', 'bloom']) {
      storage.setItem('aura.theme', name);
      listLiked.mockResolvedValueOnce([]);
      const tree = await mount(<LikedScreen navigation={nav} />);
      const t = themes[name];
      expect(control(tree).props.colors).toEqual([t.accent]);
      expect(control(tree).props.tintColor).toBe(t.accent);
      // The puck behind the arc is one of the app's own surfaces — white
      // would be a hole in midnight and invisible on dusk.
      expect(control(tree).props.progressBackgroundColor).toBe(t.surface);
    }
    storage.setItem('aura.theme', 'dusk');
  });

  test('history refreshes page one — the cursor and the rows stay one list', async () => {
    getHistory.mockResolvedValueOnce({
      plays: [{ ...track('a'), playedAt: Date.now() }],
      nextBefore: 'cursor-1',
    });
    const tree = await mount(<HistoryScreen navigation={nav} />);
    expect(getHistory).toHaveBeenCalledTimes(1);
    expect(titles(tree)).toEqual(['song a']);

    getHistory.mockResolvedValueOnce({
      plays: [
        { ...track('c'), playedAt: Date.now() },
        { ...track('a'), playedAt: Date.now() },
      ],
      nextBefore: 'cursor-2',
    });
    await ReactTestRenderer.act(async () => {
      await control(tree).props.onRefresh();
    });

    // Page one asked for again — no `before`, so the refresh can never splice
    // a page into the middle of the list it is replacing.
    expect(getHistory).toHaveBeenCalledTimes(2);
    expect(getHistory.mock.calls[1][0].before).toBeUndefined();
    expect(titles(tree)).toEqual(['song c', 'song a']);
    expect(control(tree).props.refreshing).toBe(false);
  });

  // Making page one reachable at any time (the pull) opened a race the screen
  // never had: a load-more already in flight is describing a list that the
  // refresh has since thrown away. Appending its page leaves a hole in the day
  // grouping, and its cursor overwrites the fresh one, so every later page
  // walks a chain that no longer exists.
  test('a load-more that started before a refresh is discarded, not spliced on', async () => {
    getHistory.mockResolvedValueOnce({
      plays: [{ ...track('a'), playedAt: Date.now() }],
      nextBefore: 'cursor-old',
    });
    const tree = await mount(<HistoryScreen navigation={nav} />);
    expect(titles(tree)).toEqual(['song a']);

    // Page two goes out and is left hanging.
    const stale = deferred();
    getHistory.mockReturnValueOnce(stale.promise);
    const more = tree.root
      .findAllByProps({ accessibilityRole: 'button' })
      .find(n => n.props.accessibilityLabel === 'load more');
    await ReactTestRenderer.act(async () => {
      more.props.onPress();
    });
    expect(getHistory).toHaveBeenCalledTimes(2);
    expect(getHistory.mock.calls[1][0].before).toBe('cursor-old');

    // The user pulls before it lands. Page one is replaced wholesale.
    getHistory.mockResolvedValueOnce({
      plays: [{ ...track('fresh'), playedAt: Date.now() }],
      nextBefore: 'cursor-fresh',
    });
    await ReactTestRenderer.act(async () => {
      await control(tree).props.onRefresh();
    });
    expect(titles(tree)).toEqual(['song fresh']);

    // NOW the stale page arrives, carrying rows from below the old cursor.
    await ReactTestRenderer.act(async () => {
      stale.resolve({
        plays: [{ ...track('ancient'), playedAt: Date.now() }],
        nextBefore: 'cursor-ancient',
      });
      await stale.promise;
    });

    // It is dropped: the fresh list is untouched...
    expect(titles(tree)).toEqual(['song fresh']);

    // ...and so is the fresh cursor — the next page must continue the list on
    // screen, not the one that was thrown away.
    getHistory.mockResolvedValueOnce({ plays: [], nextBefore: null });
    const more2 = tree.root
      .findAllByProps({ accessibilityRole: 'button' })
      .find(n => n.props.accessibilityLabel === 'load more');
    await ReactTestRenderer.act(async () => {
      more2.props.onPress();
    });
    expect(getHistory.mock.calls[3][0].before).toBe('cursor-fresh');
  });
});
