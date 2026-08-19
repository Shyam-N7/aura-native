import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

// The invariant under test is structural, so the gesture layer is stubbed
// down to something inspectable: a GestureDetector that records the element
// it was handed as its child.
const seen = { child: null };
jest.mock('react-native-gesture-handler', () => {
  return {
    __esModule: true,
    Gesture: {
      // Every builder method returns the chain, whichever ones Bounce uses.
      Pan: () => {
        const chain = new Proxy(
          {},
          {
            get: () => () => chain,
          },
        );
        return chain;
      },
      Native: () => ({}),
      Simultaneous: (...gs) => ({ kind: 'simultaneous', gs }),
    },
    GestureDetector: ({ children }) => {
      seen.child = children;
      return children;
    },
  };
});

const {
  BounceScrollView,
  BounceFlatList,
  BounceSectionList,
} = require('../src/components/ui/Bounce');

const render = async ui => {
  let tree;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(ui);
  });
  return tree;
};

beforeEach(() => {
  seen.child = null;
});

// Why this test exists.
//
// Bounce composes `Gesture.Simultaneous(Gesture.Native(), pan)`, and
// `Gesture.Native()` binds to the GestureDetector's DIRECT child view. The
// rubber band only runs alongside the native scroll while that child is the
// scroller itself.
//
// Passing `refreshControl` broke exactly that: on Android RN renders the
// control as the OUTER native view with the scroller inside it, so the
// detector's child became a SwipeRefreshLayout. The band started competing
// with the scroll instead of joining it, and SwipeRefreshLayout — which
// intercepts single-pointer drags and ignores multi-touch — ate one-finger
// scrolling on all eight screens that adopted it. Two fingers still scrolled.
//
// No render assertion catches that on its own, because the wrapping happens
// inside RN's ScrollView on a real platform. What IS assertable here is the
// precondition the whole design rests on: nothing may come between the
// detector and the scroller, and no prop that would introduce a wrapper may
// be forwarded.
describe('Bounce keeps the scroller as the gesture detector’s direct child', () => {
  it.each([
    ['BounceScrollView', BounceScrollView],
    ['BounceFlatList', BounceFlatList],
    ['BounceSectionList', BounceSectionList],
  ])('%s hands the scroller straight to GestureDetector', async (_name, C) => {
    await render(<C data={[]} sections={[]} renderItem={() => null} />);
    expect(seen.child).not.toBeNull();
    // One element, not a wrapper around one.
    expect(React.Children.count(seen.child)).toBe(1);
    expect(seen.child.props.refreshControl).toBeUndefined();
  });

  // The band's transform has to reach the scroller. RN splits a style array
  // across an outer wrapper and the inner scroller when one exists, and
  // `transform` goes to the OUTER half — so a wrapper silently steals it.
  it('drives the band through the scroller’s own style', async () => {
    await render(<BounceScrollView />);
    const style = [].concat(seen.child.props.style ?? []).filter(Boolean);
    expect(style.length).toBeGreaterThan(0);
  });

  // A caller must not be able to reintroduce the wrapper through ...props.
  // `refreshControl` is the obvious door; `onRefresh` is the one that cost an
  // evening, because VirtualizedList builds its OWN RefreshControl from it
  // when none was passed — same wrapper, no control in sight at the call site.
  it.each(['refreshControl', 'onRefresh', 'refreshing', 'progressViewOffset'])(
    'swallows %s instead of forwarding it',
    async prop => {
      const value =
        prop === 'refreshControl' ? <Text>spinner</Text>
        : prop === 'onRefresh' ? () => {}
        : prop === 'refreshing' ? true
        : 40;
      await render(
        <BounceScrollView {...{ [prop]: value }}>
          <Text>row</Text>
        </BounceScrollView>,
      );
      expect(seen.child.props[prop]).toBeUndefined();
    },
  );
});
