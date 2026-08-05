import React from 'react';
import { Text, TextInput } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { TopBar } from '../src/components/nav/TopBar';
import { closeSearch, getSearchQuery } from '../src/lib/searchQuery';

// The bar SUBSCRIBES to identity rather than re-reading it each render, so the
// stub needs a real notify path and not just a getter — a getter-only stub
// passes whether or not the subscription exists, which is how the stale mode
// pill shipped.
const DEFAULT_USER = { name: 'aura', activeMode: 'everyday', modes: [] };
let mockUser = DEFAULT_USER;
const mockAuthSubs = new Set();
function mockSetUser(next) {
  mockUser = next;
  mockAuthSubs.forEach(fn => fn());
}

jest.mock('../src/lib/auth', () => ({
  getUser: () => mockUser,
  subscribeAuth: fn => {
    mockAuthSubs.add(fn);
    return () => mockAuthSubs.delete(fn);
  },
}));

// First match is the composite Pressable/PressScale (host views repeat a11y
// props) — same helper shape as the other nav tests (Dock.test.jsx).
const byLabel = (tree, accessibilityLabel) =>
  tree.root.findAllByProps({ accessibilityLabel })[0];

// Walks up from a control to the nearest ancestor exposing `pointerEvents` —
// that's the layer (bar-content or search-field) the control lives in, so
// this reads which layer is currently interactive without touching the
// reanimated shared values driving the visual fade/scale.
function layerPointerEvents(node) {
  let n = node;
  while (n && n.props.pointerEvents === undefined) {
    n = n.parent;
  }
  return n?.props.pointerEvents;
}

function render(goTab) {
  let tree;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <TopBar activeTab="Home" goTab={goTab} />
      </ThemeProvider>,
    );
  });
  return tree;
}

// The mode pill's own Text — what a mode switch has to repaint.
const modeLabelOf = tree =>
  byLabel(tree, 'listening mode').findByType(Text).props.children;

beforeEach(() => {
  // Module-scope bus shared with SearchScreen — reset between tests.
  closeSearch();
  mockUser = DEFAULT_USER;
  mockAuthSubs.clear();
});

test('the search chip morphs the pill into the field and navigates to Search', () => {
  const goTab = jest.fn();
  const tree = render(goTab);

  // Resting: the bar layer is interactive, the field layer is not.
  expect(layerPointerEvents(byLabel(tree, 'open search'))).toBe('auto');
  expect(layerPointerEvents(byLabel(tree, 'close search'))).toBe('none');

  ReactTestRenderer.act(() => {
    byLabel(tree, 'open search').props.onPress();
  });

  expect(goTab).toHaveBeenCalledWith('Search');
  expect(layerPointerEvents(byLabel(tree, 'open search'))).toBe('none');
  expect(layerPointerEvents(byLabel(tree, 'close search'))).toBe('auto');

  ReactTestRenderer.act(() => tree.unmount());
});

test('typing in the morphed field lands on the shared query bus', () => {
  const tree = render(jest.fn());

  ReactTestRenderer.act(() => {
    byLabel(tree, 'open search').props.onPress();
  });
  const input = tree.root.findByType(TextInput);
  ReactTestRenderer.act(() => {
    input.props.onChangeText('halcyon');
  });
  expect(getSearchQuery()).toBe('halcyon');
  expect(input.props.value).toBe('halcyon');

  ReactTestRenderer.act(() => tree.unmount());
});

test('a mode switch repaints the pill with no other reason to re-render', () => {
  const tree = render(jest.fn());
  expect(modeLabelOf(tree)).toBe('everyday');

  // Exactly what setActiveMode does: persist the new identity, then notify.
  // Nothing else about the bar changes here — no theme cycle, no search morph,
  // no player update — so only a live subscription can move the pill. Without
  // one this stays 'everyday' until something unrelated re-renders the bar.
  ReactTestRenderer.act(() => {
    mockSetUser({
      name: 'aura',
      activeMode: 'focus',
      modes: [{ key: 'focus', label: 'Focus' }],
    });
  });

  expect(modeLabelOf(tree)).toBe('focus');

  ReactTestRenderer.act(() => tree.unmount());
});

test('the identity subscription is released on unmount', () => {
  const tree = render(jest.fn());
  expect(mockAuthSubs.size).toBe(1);

  ReactTestRenderer.act(() => tree.unmount());

  // A bar that outlives its subscription would keep a torn-down tree reachable
  // from the auth bus for the rest of the process.
  expect(mockAuthSubs.size).toBe(0);
});

test('‹ restores the bar and clears the query', () => {
  const tree = render(jest.fn());

  ReactTestRenderer.act(() => {
    byLabel(tree, 'open search').props.onPress();
  });
  ReactTestRenderer.act(() => {
    tree.root.findByType(TextInput).props.onChangeText('halcyon');
  });

  ReactTestRenderer.act(() => {
    byLabel(tree, 'close search').props.onPress();
  });

  expect(getSearchQuery()).toBe('');
  expect(layerPointerEvents(byLabel(tree, 'open search'))).toBe('auto');
  expect(layerPointerEvents(byLabel(tree, 'close search'))).toBe('none');

  ReactTestRenderer.act(() => tree.unmount());
});
