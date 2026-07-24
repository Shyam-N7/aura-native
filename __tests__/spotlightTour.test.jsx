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
  stepDwell,
  toggleTourPause,
  tourSeen,
} from '../src/lib/spotlightTour';
import { buildSettingsTour } from '../src/lib/tourSteps';
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

  test('back steps within bounds, and holds there', () => {
    startTour(DEF);
    nextStep();
    backStep();
    expect(getTourState().step).toBe(0);
    // Going back is "show me that again" — the self-driving clock stops so the
    // step can't slide away a beat later.
    expect(getTourState().paused).toBe(true);
    backStep(); // already at 0 — no-op
    expect(getTourState().step).toBe(0);
  });

  test('hold pauses and resumes the self-driving clock', () => {
    startTour(DEF);
    expect(getTourState().paused).toBe(false);
    toggleTourPause();
    expect(getTourState().paused).toBe(true);
    toggleTourPause();
    expect(getTourState().paused).toBe(false);
  });

  test('the settings tour walks the shelf: tap-to-expand, then the rows it opens', () => {
    const { steps } = buildSettingsTour({ admin: true });
    const expand = steps.findIndex(s => s.title === 'tap to expand');
    expect(expand).toBeGreaterThan(-1);
    // It shows the shelf CLOSED, and the very next step opens it — the tour
    // acting out the tap rather than describing it.
    expect(steps[expand].collapse).toBe(true);
    expect(steps[expand + 1].open).toBe('settings');
    // Each in-settings step points at its own control, never the whole block
    // (a spotlight over everything highlights nothing).
    for (const title of ['private session', 'family mode', 'notifications']) {
      const s = steps.find(x => x.title === title);
      expect(s.target).toBeTruthy();
      expect(s.target).not.toBe('shelves');
    }
    // Targets are distinct, so consecutive steps actually move the spotlight.
    const inSettings = steps.filter(s => s.open === 'settings').map(s => s.target);
    expect(new Set(inSettings).size).toBe(inSettings.length);
  });

  test('dwell scales with the copy, within bounds, and honors an override', () => {
    const short = stepDwell({ title: 'hi', body: '' });
    const long = stepDwell({ title: 'a much longer heading', body: 'x'.repeat(400) });
    expect(long).toBeGreaterThan(short);
    expect(short).toBeGreaterThanOrEqual(2600); // floor — never flashes past
    expect(long).toBeLessThanOrEqual(6400); // ceiling — never overstays
    expect(stepDwell({ title: 'x', body: 'y', dwell: 1234 })).toBe(1234);
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

  test('drives itself: a step advances on its own once its dwell elapses', async () => {
    jest.useFakeTimers();
    try {
      let tree;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(
          <ThemeProvider>
            <SpotlightTourOverlay targets={{}} />
          </ThemeProvider>,
        );
      });
      await ReactTestRenderer.act(async () => {
        startTour(DEF);
      });
      expect(getTourState().step).toBe(0);

      // No tap, no press — just time passing.
      await ReactTestRenderer.act(async () => {
        jest.advanceTimersByTime(stepDwell(DEF.steps[0]) + 50);
      });
      expect(getTourState().step).toBe(1);

      // Holding freezes it: the same wait no longer moves the tour on.
      await ReactTestRenderer.act(async () => {
        toggleTourPause();
      });
      await ReactTestRenderer.act(async () => {
        jest.advanceTimersByTime(10_000);
      });
      expect(getTourState().step).toBe(1);

      await ReactTestRenderer.act(async () => {
        endTour();
      });
      await ReactTestRenderer.act(() => tree.unmount());
    } finally {
      jest.useRealTimers();
    }
  });
});
