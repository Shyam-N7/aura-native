import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { Toast } from '../src/components/Toast';
import { showToast, subscribeToast } from '../src/lib/toast';
import { DUR } from '../src/theme/motion';
import { resetRenderCounts } from '../src/lib/renderCount';

// The toast's undo affordance. Destructive work in this app used to be final:
// the row went, a pill said so, and the only way back — where there was one at
// all — was a settings screen. showToast now takes an optional
// { label, onPress } action, and these are the four things that have to be
// true about it: the handler runs exactly ONCE, the tap dismisses the pill,
// a toast with no action behaves exactly as it always did, and an undo that
// reaches an adopter actually puts the state back.

jest.mock('../src/playback/PlayerContext', () => ({
  usePlayer: () => ({ current: null, playQueue: jest.fn(), ui: {} }),
}));
jest.mock('../src/api/hidden', () => ({
  hideTrack: jest.fn(() => Promise.resolve()),
  unhideTrack: jest.fn(() => Promise.resolve()),
  listHidden: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../src/api/discover', () => ({ getCatalogPlaylist: jest.fn() }));

const { hideTrack, unhideTrack } = require('../src/api/hidden');
const CatalogPlaylistScreen =
  require('../src/screens/CatalogPlaylistScreen').default;

// Drop anything left in the bus's pending buffer between tests.
const drain = () => subscribeToast(() => {})();

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
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
}

const tick = async ms =>
  ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(ms);
  });

// The full statement life: in, hold, out.
const PLAIN_LIFE = DUR.toastIn + DUR.toastHold + DUR.toastIn;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  drain();
});
afterEach(() => {
  drain();
  jest.useRealTimers();
  resetRenderCounts();
});

test('the action runs exactly once, and the tap is what dismisses the pill', async () => {
  const undo = jest.fn();
  const tree = await render(<Toast />);
  await ReactTestRenderer.act(async () => {
    showToast('Removed.', { action: { label: 'Undo', onPress: undo } });
  });

  expect(texts(tree.toJSON())).toContain('Removed.');
  expect(texts(tree.toJSON())).toContain('Undo');
  // Lowercase label + button role, like every other control in the app.
  const action = byLabel(tree, 'undo');
  expect(action.props.accessibilityRole).toBe('button');

  // Two taps in the same beat — a fat-fingered double tap must not re-add a
  // track twice.
  await ReactTestRenderer.act(async () => {
    action.props.onPress();
    action.props.onPress();
  });
  expect(undo).toHaveBeenCalledTimes(1);

  // The pill answers the tap immediately: out and gone in one exit, without
  // waiting for the hold it was still sitting in.
  await tick(DUR.toastIn);
  expect(tree.toJSON()).toBeNull();

  // The hold timer this raced is cancelled — it cannot fire the handler again
  // (and never could have: expiry dismisses, it does not take the offer).
  await tick(DUR.toastHoldAction * 2);
  expect(undo).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(() => tree.unmount());
});

test('an offer gets the long window; letting it expire is not taking it', async () => {
  const undo = jest.fn();
  const tree = await render(<Toast />);
  await ReactTestRenderer.act(async () => {
    showToast('Removed.', { action: { label: 'Undo', onPress: undo } });
  });

  // Past the statement window, which would have taken a plain toast away
  // before the thumb had finished reading it.
  await tick(PLAIN_LIFE + 10);
  expect(texts(tree.toJSON())).toContain('Undo');

  // Out at the action window instead, with the offer simply declined.
  await tick(DUR.toastHoldAction + DUR.toastIn);
  expect(tree.toJSON()).toBeNull();
  expect(undo).not.toHaveBeenCalled();

  await ReactTestRenderer.act(() => tree.unmount());
});

test('a plain toast is untouched — no control, no touch target, same life', async () => {
  const tree = await render(<Toast />);
  await ReactTestRenderer.act(async () => {
    showToast('Saved.');
  });

  expect(texts(tree.toJSON())).toContain('Saved.');
  expect(tree.root.findAllByProps({ accessibilityRole: 'button' })).toHaveLength(
    0,
  );
  // The wrap spans the screen; without a control it must stay untouchable.
  expect(tree.toJSON().props.pointerEvents).toBe('none');

  await tick(PLAIN_LIFE);
  expect(tree.toJSON()).toBeNull();

  await ReactTestRenderer.act(() => tree.unmount());
});

test('a newer message waits behind a live undo instead of swallowing it', async () => {
  const undo = jest.fn();
  const tree = await render(<Toast />);
  await ReactTestRenderer.act(async () => {
    showToast('Removed.', { action: { label: 'Undo', onPress: undo } });
  });
  await tick(DUR.toastIn);

  // Last-write-wins would have replaced the pill here and taken the only way
  // back with it, silently, mid-reach.
  await ReactTestRenderer.act(async () => {
    showToast('Added to your queue.');
  });
  expect(texts(tree.toJSON())).toContain('Removed.');

  // The offer is still takeable, and the waiting message lands after it.
  await ReactTestRenderer.act(async () => {
    byLabel(tree, 'undo').props.onPress();
  });
  expect(undo).toHaveBeenCalledTimes(1);
  await tick(DUR.toastIn);
  expect(texts(tree.toJSON())).toContain('Added to your queue.');

  await ReactTestRenderer.act(() => tree.unmount());
});

test('the queue holds one message, newest wins, and an expiry releases it', async () => {
  const tree = await render(<Toast />);
  await ReactTestRenderer.act(async () => {
    showToast('Removed.', { action: { label: 'Undo', onPress: jest.fn() } });
  });
  await ReactTestRenderer.act(async () => {
    showToast('Older news.');
    showToast('Newer news.');
  });

  // Nobody took the offer: it expires on its own and the newest of the
  // messages that piled up behind it goes on screen. Only that one — a burst
  // must not become a backlog of stale pills to sit through.
  await tick(DUR.toastIn + DUR.toastHoldAction + DUR.toastIn);
  const after = texts(tree.toJSON());
  expect(after).toContain('Newer news.');
  expect(after).not.toContain('Older news.');

  await tick(PLAIN_LIFE);
  expect(tree.toJSON()).toBeNull();

  await ReactTestRenderer.act(() => tree.unmount());
});

test('a half-built action degrades to a plain toast rather than a dead button', () => {
  const seen = [];
  const off = subscribeToast(e => seen.push(e));
  showToast('Removed.', { action: { label: 'Undo' } });
  showToast('Removed.', { action: { onPress: jest.fn() } });
  showToast('Removed.', { action: { label: 'Undo', onPress: jest.fn() } });
  off();

  expect(seen.map(e => e.action)).toEqual([
    null,
    null,
    expect.objectContaining({ label: 'Undo' }),
  ]);
});

// ── The adopter ──────────────────────────────────────────────────────
// "Don't show this again" on a made-for-you mix, end to end through the real
// screen and the real toast bus: hiding drops the row, and the undo on the
// pill unhides the track and puts the row back WHERE IT WAS.
test('undo on "don’t show this again" unhides the track and restores the row', async () => {
  const mix = {
    kind: 'auto',
    name: 'Late night',
    tracks: [
      { id: 't1', title: 'One', artist: 'A', language: 'tamil' },
      { id: 't2', title: 'Two', artist: 'B', language: 'tamil' },
      { id: 't3', title: 'Three', artist: 'C', language: 'tamil' },
    ],
  };
  const events = [];
  const off = subscribeToast(e => events.push(e));

  const tree = await render(
    <CatalogPlaylistScreen
      route={{ params: { id: 'auto1', initialData: mix } }}
      navigation={{ goBack: jest.fn() }}
    />,
  );

  const rowTitles = () =>
    tree.root
      .findAll(n => typeof n.props?.track?.id === 'string' && !!n.props?.menu)
      .map(n => n.props.track.id)
      .filter((v, i, a) => a.indexOf(v) === i);
  expect(rowTitles()).toEqual(['t1', 't2', 't3']);

  // The middle row's "Don't show this again".
  const menuOf = id =>
    tree.root.findAll(
      n => n.props?.track?.id === id && n.props?.menu?.extras?.length,
    )[0].props.menu;
  const hide = menuOf('t2').extras.find(x => x.label.includes("Don't show"));
  await ReactTestRenderer.act(async () => {
    hide.onPress();
  });

  expect(hideTrack).toHaveBeenCalledWith('t2');
  expect(rowTitles()).toEqual(['t1', 't3']);

  // The toast carries the way back, and no longer sends anyone to settings.
  const hidden = events[events.length - 1];
  expect(hidden.message).toBe("Hidden — AURA won't pick this for you again.");
  expect(hidden.message).not.toContain('settings');
  expect(hidden.action.label).toBe('Undo');

  await ReactTestRenderer.act(async () => {
    hidden.action.onPress();
  });

  expect(unhideTrack).toHaveBeenCalledWith('t2');
  // Back in the middle, not appended: the mix's order is the server's and
  // hiding never touched it.
  expect(rowTitles()).toEqual(['t1', 't2', 't3']);
  expect(events[events.length - 1].message).toBe('Back in your mixes.');

  off();
  await ReactTestRenderer.act(() => tree.unmount());
});

// The bug this guards: `box-none` was set on the wrap and the pill's outer
// Animated.View, and a comment claimed that handed taps to the control inside.
// It did not — box-none means "not me, try my children", and the glass shell
// between them hit-tested as `auto`, so Android stopped there and every tap
// that missed Undo was swallowed for the whole five seconds the offer stood.
// Assert the entire chain, not just the outermost view, because checking only
// the outer one is precisely what let this ship.
test('an actionable pill hands every tap it does not own to the screen beneath', async () => {
  const tree = await render(<Toast />);
  await ReactTestRenderer.act(async () => {
    showToast('Removed.', { action: { label: 'Undo', onPress: () => {} } });
  });

  // Walk from the root down to the Undo control and collect what each view
  // says about touch. Nothing on that path may be a target.
  const action = byLabel(tree, 'undo');
  const chain = [];
  let node = action.parent;
  while (node) {
    if (typeof node.type === 'string' && node.props.style) {
      chain.push(node.props.pointerEvents);
    }
    node = node.parent;
  }
  expect(chain.length).toBeGreaterThanOrEqual(3);
  for (const pe of chain) {
    expect(pe).toBe('box-none');
  }

  // The control itself must stay hittable — it is the one thing that is.
  expect(action.props.pointerEvents).toBeUndefined();

  // And the words sit inside a view that opts out, since a <Text> cannot opt
  // out of touch on Android — without that wrapper the message itself is a
  // target and eats the tap even with every ancestor set correctly.
  const message = tree.root
    .findAllByType('Text')
    .find(t => t.props.children === 'Removed.');
  expect(message).toBeTruthy();
  let wrapped = false;
  for (let n = message.parent; n; n = n.parent) {
    if (n.props?.pointerEvents === 'none') {
      wrapped = true;
      break;
    }
  }
  expect(wrapped).toBe(true);
});
