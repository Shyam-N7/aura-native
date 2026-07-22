import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { Dock } from '../src/components/nav/Dock';

jest.mock('../src/playback/PlayerContext', () => ({
  usePlayer: () => ({ current: null }),
}));

// A hand-rolled navigation container ref: live state and the 'state' event
// channel are deliberately decoupled so tests can reproduce the field desync
// (highlight fed one thing while the container holds another).
function makeNavRef(liveState) {
  const listeners = [];
  return {
    isReady: () => true,
    getRootState: () => liveState.current,
    navigate: jest.fn(),
    addListener: (event, cb) => {
      if (event === 'state') {
        listeners.push(cb);
      }
      return () => {};
    },
    emit: state => listeners.forEach(cb => cb({ data: { state } })),
  };
}

const tabsState = index => ({ routes: [{ name: 'Tabs', state: { index } }] });

// First match is the composite Pressable (host views repeat its a11y props).
const byLabel = (tree, accessibilityLabel) =>
  tree.root.findAllByProps({ accessibilityLabel })[0];

const selected = (tree, tabLabel) =>
  !!byLabel(tree, tabLabel).props.accessibilityState?.selected;

async function render(navRef) {
  let tree;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <Dock navRef={navRef} />
      </ThemeProvider>,
    );
  });
  return tree;
}

test('highlight follows the state carried by nav events', async () => {
  const liveState = { current: tabsState(0) };
  const navRef = makeNavRef(liveState);
  const tree = await render(navRef);
  expect(selected(tree, 'home')).toBe(true);

  liveState.current = tabsState(1);
  await ReactTestRenderer.act(async () => {
    navRef.emit(liveState.current);
  });
  expect(selected(tree, 'search')).toBe(true);
  expect(selected(tree, 'home')).toBe(false);

  await ReactTestRenderer.act(() => tree.unmount());
});

test('taps always navigate — even the focused tab (pops detail screens)', async () => {
  const liveState = { current: tabsState(0) };
  const navRef = makeNavRef(liveState);
  const tree = await render(navRef);

  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'talk').props.onPress();
  });
  expect(navRef.navigate).toHaveBeenCalledWith('Tabs', { screen: 'Talk' });

  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'home').props.onPress();
  });
  expect(navRef.navigate).toHaveBeenCalledWith('Tabs', { screen: 'Home' });

  await ReactTestRenderer.act(() => tree.unmount());
});

test('a stale highlight heals on tap instead of locking (field regression)', async () => {
  const liveState = { current: tabsState(0) };
  const navRef = makeNavRef(liveState);
  const tree = await render(navRef);

  // Birth the desync: an event parks the highlight on "you" while the
  // container actually sits on home.
  await ReactTestRenderer.act(async () => {
    navRef.emit(tabsState(3));
  });
  expect(selected(tree, 'you')).toBe(true);

  // Tapping home navigates (a no-op inside the container, so no state event
  // will come back) and the tap-time resync re-trues the highlight anyway.
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'home').props.onPress();
  });
  expect(navRef.navigate).toHaveBeenCalledWith('Tabs', { screen: 'Home' });
  expect(selected(tree, 'home')).toBe(true);
  expect(selected(tree, 'you')).toBe(false);

  await ReactTestRenderer.act(() => tree.unmount());
});
