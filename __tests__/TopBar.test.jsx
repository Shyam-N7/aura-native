import React from 'react';
import { TextInput } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { TopBar } from '../src/components/nav/TopBar';
import { closeSearch, getSearchQuery } from '../src/lib/searchQuery';

jest.mock('../src/lib/auth', () => ({
  getUser: () => ({ name: 'aura', activeMode: 'everyday', modes: [] }),
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

function render(navigation) {
  let tree;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <TopBar navigation={navigation} />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  // Module-scope bus shared with SearchScreen — reset between tests.
  closeSearch();
});

test('the search chip morphs the pill into the field and navigates to Search', () => {
  const navigation = {
    navigate: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  };
  const tree = render(navigation);

  // Resting: the bar layer is interactive, the field layer is not.
  expect(layerPointerEvents(byLabel(tree, 'open search'))).toBe('auto');
  expect(layerPointerEvents(byLabel(tree, 'close search'))).toBe('none');

  ReactTestRenderer.act(() => {
    byLabel(tree, 'open search').props.onPress();
  });

  expect(navigation.navigate).toHaveBeenCalledWith('Search');
  expect(layerPointerEvents(byLabel(tree, 'open search'))).toBe('none');
  expect(layerPointerEvents(byLabel(tree, 'close search'))).toBe('auto');

  ReactTestRenderer.act(() => tree.unmount());
});

test('typing in the morphed field lands on the shared query bus', () => {
  const navigation = {
    navigate: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  };
  const tree = render(navigation);

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

test('‹ restores the bar and clears the query', () => {
  const navigation = {
    navigate: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  };
  const tree = render(navigation);

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
