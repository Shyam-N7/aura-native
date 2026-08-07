import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { NavigationContext } from '@react-navigation/native';
import { useBackToTop } from '../src/hooks/useBackToTop';
import {
  clearScrollDepth,
  setScrollDepth,
  subscribeScrollDepth,
} from '../src/lib/scrollDepth';

// Back-to-top is not a floating button — the control IS the dock, which
// contracts into a "take me back up" pill. A screen's whole job is to report
// depth and hand over a way back up. Home did that inline, which is why Home
// was the only screen that had it.
//
// The trap this hook exists for: Home's callback was
// `ref.current?.scrollTo?.({ y: 0 })`, and Bounce forwards its ref straight to
// the RN instance. On a FlatList there is no scrollTo, so the optional call
// swallows it and fails SILENTLY — dock contracts, pill does nothing. Every
// screen being adopted is a FlatList or a SectionList.

// A probe that hands the hook whatever scroller shape we want to test.
function Probe({ node, onReady }) {
  const backToTop = useBackToTop();
  backToTop.ref.current = node;
  onReady(backToTop);
  return null;
}

const mount = async (node, nav) => {
  let api = null;
  let tree = null;
  const el = <Probe node={node} onReady={a => (api = a)} />;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      nav ? (
        <NavigationContext.Provider value={nav}>{el}</NavigationContext.Provider>
      ) : (
        el
      ),
    );
  });
  return { get: () => api, unmount: () => ReactTestRenderer.act(() => tree.unmount()) };
};

// Read the bus the way the dock does.
const latest = () => {
  let seen = null;
  const off = subscribeScrollDepth(s => (seen = s));
  off();
  return seen;
};

beforeEach(() => clearScrollDepth());
afterEach(() => clearScrollDepth());

// ── T1: the trap ───────────────────────────────────────────────────────────
describe('the way back up matches the scroller it was given', () => {
  test('a FlatList is scrolled by scrollToOffset, not scrollTo', async () => {
    const scrollToOffset = jest.fn();
    const p = await mount({ scrollToOffset });

    p.get().onDeepChange(true);
    latest().toTop();

    // Home's line would have been a silent no-op here: FlatList has no
    // scrollTo, and `?.()` swallows the missing method.
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
    await p.unmount();
  });

  test('a ScrollView is scrolled by scrollTo', async () => {
    const scrollTo = jest.fn();
    const p = await mount({ scrollTo });

    p.get().onDeepChange(true);
    latest().toTop();

    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
    await p.unmount();
  });

  test('a SectionList goes through its scroll responder, not scrollToLocation', async () => {
    const responderScrollTo = jest.fn();
    const scrollToLocation = jest.fn();
    const p = await mount({
      scrollToLocation,
      getScrollResponder: () => ({ scrollTo: responderScrollTo }),
    });

    p.get().onDeepChange(true);
    latest().toTop();

    expect(responderScrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
    // scrollToLocation would land BELOW the list header — not the top.
    expect(scrollToLocation).not.toHaveBeenCalled();
    await p.unmount();
  });

  test('a missing scroller is a no-op, not a crash', async () => {
    const p = await mount(null);
    p.get().onDeepChange(true);
    expect(() => latest().toTop()).not.toThrow();
    await p.unmount();
  });
});

// ── T2: the blur guard ─────────────────────────────────────────────────────
describe('a parked screen cannot move the dock', () => {
  const fakeNav = () => {
    const listeners = {};
    return {
      isFocused: () => true,
      addListener: (ev, fn) => {
        listeners[ev] = fn;
        return () => delete listeners[ev];
      },
      fire: ev => listeners[ev]?.(),
    };
  };

  test('blur clears the flag so the dock does not contract elsewhere', async () => {
    const nav = fakeNav();
    const p = await mount({ scrollToOffset: jest.fn() }, nav);
    p.get().onDeepChange(true);
    expect(latest().deep).toBe(true);

    await ReactTestRenderer.act(async () => nav.fire('blur'));

    expect(latest().deep).toBe(false);
    await p.unmount();
  });

  test("a parked screen's late idle report cannot drop another screen's pill", async () => {
    const nav = fakeNav();
    const parked = await mount({ scrollToOffset: jest.fn() }, nav);
    await ReactTestRenderer.act(async () => nav.fire('blur'));

    // Another screen is now the producer and is scrolled deep.
    setScrollDepth(true, () => {});

    // Bounce's idle relax is a JS timer, so a screen left mid-scroll fires
    // onDeepChange(false) AFTER it was parked. Without the focus gate that
    // late report lands on whoever is producing now.
    parked.get().onDeepChange(false);

    expect(latest().deep).toBe(true);
    await parked.unmount();
  });
});

// ── T3: the screens are actually wired ─────────────────────────────────────
// Reaching onDeepChange through the rendered scroller is the only honest
// check: it can never fire by itself under jest, because Bounce raises it from
// a worklet via runOnJS.
describe('the adopting screens report depth', () => {
  test('every long list passes a depth reporter to its scroller', () => {
    const fs = require('fs');
    const path = require('path');
    const screens = [
      'LikedScreen.jsx',
      'AlbumScreen.jsx',
      'PlaylistScreen.jsx',
      'CatalogPlaylistScreen.jsx',
      'HistoryScreen.jsx',
      'YouScreen.jsx',
      'HomeScreen.jsx',
    ];
    for (const name of screens) {
      const body = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'screens', name),
        'utf8',
      );
      expect(body).toContain('useBackToTop');
      expect(body).toContain('{...backToTop}');
    }
  });

  // The screens deliberately left out. A control that can never appear is dead
  // weight, and one on a five-row list is noise — see the plan for the rule.
  test('the screens you leave rather than scroll back up do not', () => {
    const fs = require('fs');
    const path = require('path');
    for (const name of [
      'ArtistScreen.jsx',
      'PlaylistsScreen.jsx',
      'SearchScreen.jsx',
      'TalkScreen.jsx',
    ]) {
      const body = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'screens', name),
        'utf8',
      );
      expect(body).not.toContain('useBackToTop');
    }
  });
});
