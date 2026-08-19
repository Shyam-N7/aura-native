import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { ProgressRibbon } from '../src/components/player/ProgressRibbon';
import { EqFader } from '../src/components/ui/EqFader';
import { EqualizerPanel } from '../src/components/audio/EqualizerPanel';

// Both of the app's sliders are driven by a pan, and a pan is unreachable
// with a screen reader on (the gap QueueSheet's reorder actions already
// closed for the queue). These pin the assistive way in: each one has to
// announce itself as an adjustable AND actually move when the action fires —
// a role with no working action is the same dead end as no role at all.

const BANDS = [
  { index: 0, centerHz: 60, minMb: -1500, maxMb: 1500 },
  { index: 1, centerHz: 1000, minMb: -1500, maxMb: 1500 },
];

const mockApplyGains = jest.fn();
jest.mock('../src/lib/equalizer', () => ({
  OUTPUTS: ['speaker', 'wired', 'bluetooth'],
  PRESETS: [{ id: 'flat', name: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0] }],
  applyGains: (...a) => mockApplyGains(...a),
  applyPreset: jest.fn(),
  getEqualizer: () => ({
    available: true,
    deviceEq: true,
    enabled: true,
    bands: [
      { index: 0, centerHz: 60, minMb: -1500, maxMb: 1500 },
      { index: 1, centerHz: 1000, minMb: -1500, maxMb: 1500 },
    ],
    gains: [400, -200],
    bassBoost: 0,
    boostMb: 0,
    boostMode: 'none',
    output: 'speaker',
    detectedOutput: 'speaker',
    pinned: false,
  }),
  matchingPreset: () => null,
  pinOutput: jest.fn(),
  setBand: jest.fn(),
  setBassBoost: jest.fn(),
  setBoost: jest.fn(),
  setEnabled: jest.fn(),
  subscribeEqualizer: () => () => {},
}));

const byLabel = (tree, accessibilityLabel) =>
  tree.root.findAllByProps({ accessibilityLabel })[0];

const act = fn => ReactTestRenderer.act(fn);

describe('the seek bar', () => {
  const render = (props = {}) => {
    let tree;
    act(() => {
      tree = ReactTestRenderer.create(
        <ProgressRibbon
          progress={0.5}
          durationSec={200}
          accent="#f00"
          dim="#000"
          {...props}
        />,
      );
    });
    return tree;
  };

  it('announces itself as an adjustable, with the time as its value', () => {
    const bar = byLabel(render(), 'seek');

    expect(bar.props.accessibilityRole).toBe('adjustable');
    expect(bar.props.accessibilityValue).toEqual({
      min: 0,
      max: 200,
      now: 100,
      text: '1:40 of 3:20',
    });
    expect(bar.props.accessibilityActions.map(a => a.name)).toEqual([
      'increment',
      'decrement',
    ]);
  });

  it('seeks by ten seconds on increment and decrement', () => {
    const onSeek = jest.fn();
    const bar = byLabel(render({ onSeek }), 'seek');

    act(() => {
      bar.props.onAccessibilityAction({
        nativeEvent: { actionName: 'increment' },
      });
    });
    // 100s + 10s of 200s.
    expect(onSeek).toHaveBeenCalledWith(0.55);

    act(() => {
      bar.props.onAccessibilityAction({
        nativeEvent: { actionName: 'decrement' },
      });
    });
    expect(onSeek).toHaveBeenLastCalledWith(0.45);
  });

  it('clamps at the ends and stays quiet with no duration', () => {
    const onSeek = jest.fn();
    const start = byLabel(render({ progress: 0, onSeek }), 'seek');
    act(() => {
      start.props.onAccessibilityAction({
        nativeEvent: { actionName: 'decrement' },
      });
    });
    expect(onSeek).toHaveBeenCalledWith(0);

    onSeek.mockClear();
    const unknown = byLabel(render({ durationSec: 0, onSeek }), 'seek');
    expect(unknown.props.accessibilityRole).toBe('adjustable');
    act(() => {
      unknown.props.onAccessibilityAction({
        nativeEvent: { actionName: 'increment' },
      });
    });
    expect(onSeek).not.toHaveBeenCalled();
  });
});

describe('an equalizer fader', () => {
  const render = (props = {}) => {
    let tree;
    act(() => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <EqFader
            label="1k"
            value={0}
            min={BANDS[0].minMb}
            max={BANDS[0].maxMb}
            {...props}
          />
        </ThemeProvider>,
      );
    });
    return tree;
  };

  it('moves the band a whole decibel per assistive action', () => {
    const onChange = jest.fn();
    const knob = byLabel(render({ onChange }), 'band 1k');

    expect(knob.props.accessibilityRole).toBe('adjustable');
    expect(knob.props.accessibilityState).toEqual({ disabled: false });

    act(() => {
      knob.props.onAccessibilityAction({
        nativeEvent: { actionName: 'increment' },
      });
    });
    expect(onChange).toHaveBeenCalledWith(100);

    act(() => {
      knob.props.onAccessibilityAction({
        nativeEvent: { actionName: 'decrement' },
      });
    });
    expect(onChange).toHaveBeenLastCalledWith(-100);
  });

  it('never pushes a band past what the hardware accepts', () => {
    const onChange = jest.fn();
    const knob = byLabel(render({ onChange, value: 1500 }), 'band 1k');

    act(() => {
      knob.props.onAccessibilityAction({
        nativeEvent: { actionName: 'increment' },
      });
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('says so when it is disabled, and does not move', () => {
    const onChange = jest.fn();
    const knob = byLabel(render({ onChange, disabled: true }), 'band 1k');

    expect(knob.props.accessibilityState).toEqual({ disabled: true });
    act(() => {
      knob.props.onAccessibilityAction({
        nativeEvent: { actionName: 'increment' },
      });
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('the equalizer panel', () => {
  it('offers the fader long-press reset as a button, for every band', () => {
    let tree;
    act(() => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <EqualizerPanel />
        </ThemeProvider>,
      );
    });

    const reset = byLabel(tree, 'reset the bands');
    expect(reset).toBeTruthy();

    act(() => reset.props.onPress());
    expect(mockApplyGains).toHaveBeenCalledWith([0, 0]);
  });
});
