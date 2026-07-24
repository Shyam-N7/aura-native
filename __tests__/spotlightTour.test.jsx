import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { SpotlightTourOverlay } from '../src/components/ui/SpotlightTourOverlay';
import {
  backStep,
  endTour,
  getTourState,
  nextStep,
  startTour,
  tourSeen,
} from '../src/lib/spotlightTour';
import { storage } from '../src/storage/mmkv';

const DEF = {
  id: 'home',
  steps: [
    { target: null, title: 'welcome to aura', body: 'hi' },
    { target: 'x', title: 'a spotlit thing', body: 'mid' },
    { target: null, title: 'that is the tour', body: 'bye' },
  ],
};

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

beforeEach(() => {
  endTour(); // no-op if inactive; clears any leftover active state
  storage.removeItem('aura.homeTourDone');
});

describe('spotlightTour engine', () => {
  test('start activates at step 0', () => {
    startTour(DEF);
    expect(getTourState()).toMatchObject({ active: true, id: 'home', step: 0 });
  });

  test('next advances; finishing past the last step marks the tour seen', () => {
    startTour(DEF);
    nextStep();
    expect(getTourState().step).toBe(1);
    nextStep();
    expect(getTourState().step).toBe(2);
    expect(tourSeen('home')).toBe(false);
    nextStep(); // past the last step → finish
    expect(getTourState().active).toBe(false);
    expect(tourSeen('home')).toBe(true);
  });

  test('back steps within bounds', () => {
    startTour(DEF);
    nextStep();
    backStep();
    expect(getTourState().step).toBe(0);
    backStep(); // already at 0 — no-op
    expect(getTourState().step).toBe(0);
  });

  test('skipping the tour marks it seen', () => {
    startTour(DEF);
    endTour();
    expect(getTourState().active).toBe(false);
    expect(tourSeen('home')).toBe(true);
  });

  test('an empty tour never activates', () => {
    startTour({ id: 'home', steps: [] });
    expect(getTourState().active).toBe(false);
  });
});

describe('SpotlightTourOverlay', () => {
  test('renders nothing when idle, the active step when running, and follows advances', async () => {
    let tree;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <SpotlightTourOverlay targets={{}} />
        </ThemeProvider>,
      );
    });
    expect(tree.toJSON()).toBeNull();

    await ReactTestRenderer.act(async () => {
      startTour(DEF);
    });
    expect(texts(tree.toJSON())).toContain('welcome to aura');

    // Engine advance flows through to the overlay via its subscription.
    await ReactTestRenderer.act(async () => {
      nextStep();
      nextStep();
    });
    expect(texts(tree.toJSON())).toContain('that is the tour');

    await ReactTestRenderer.act(async () => {
      endTour();
    });
    expect(tree.toJSON()).toBeNull();
    await ReactTestRenderer.act(() => tree.unmount());
  });
});
