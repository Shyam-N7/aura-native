import React from 'react';
import { PixelRatio } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { ThemeProvider } from '../src/theme/ThemeContext';

// getItemLayout tells the virtualizer where every row IS, and it is believed
// without measurement. If the promise and the rendered row ever disagree the
// failure is visible — overlapping or gapped rows — not merely slow. So the
// height has to be true by construction, and this is the guard that says so.
//
// Unlike the rest of Batch G, this is a real assertion rather than a contract
// lock: it renders the row and reads the height back off it.
//
// The font scale is read once at module load (Android recreates the activity
// when it changes), so each case has to load the chassis under its own scale.
// Worth knowing: jest's react-native preset reports a scale of TWO, which is
// why the disarmed path is the one that runs by default here.
// Two loaders, because they answer different questions.
//
// `exportsAt` is for the pure module-level checks and uses isolateModules, so
// each scale gets its own evaluation of the gate.
const exportsAt = scale => {
  let mod;
  jest.isolateModules(() => {
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(scale);
    mod = require('../src/components/detail/DetailChassis');
  });
  jest.restoreAllMocks();
  return mod;
};

// `rendered` is for the checks that actually mount a row. It deliberately does
// NOT isolate: a fresh module registry hands the chassis a second copy of
// React, and useContext from one React inside a renderer from another throws.
// The trade is that only ONE scale can be rendered per file — the armed one,
// which is the case that has to be true.
let cached = null;
const rendered = () => {
  if (!cached) {
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1);
    cached = require('../src/components/detail/DetailChassis');
  }
  return cached;
};

const TRACK = {
  id: 't1',
  title: 'a song',
  artist: 'somebody',
  language: 'tamil',
  durationSec: 210,
  imageUrl: 'https://example.test/art_150x150.jpg',
};

const heightOf = element => {
  let tree;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  // The row's outermost View carries the pinned height.
  const root = tree.root.findAllByType('View')[0];
  const flat = [root.props.style].flat(Infinity).filter(Boolean);
  return flat.reduce((h, s) => (s?.height != null ? s.height : h), null);
};

const ROW_MENU = {};

describe('at the default font scale, the row is exactly as tall as promised', () => {
  test('a rendered row is DETAIL_ROW_H tall', () => {
    const { DetailRow, DETAIL_ROW_H } = rendered();
    expect(DETAIL_ROW_H).toBe(68);
    expect(heightOf(<DetailRow track={TRACK} index={0} menu={ROW_MENU} />)).toBe(
      DETAIL_ROW_H,
    );
  });

  test('an explainer line does not change the height', () => {
    // Playlist and CatalogPlaylist pass `reason` ("added by …", the mix
    // explainer). It is the tallest the meta column ever gets, and the 54px
    // art still dominates — which is the assumption DETAIL_ROW_H rests on.
    const { DetailRow, DETAIL_ROW_H } = rendered();
    expect(
      heightOf(
        <DetailRow
          track={TRACK}
          index={0}
          menu={ROW_MENU}
          reason="added by you"
        />,
      ),
    ).toBe(DETAIL_ROW_H);
  });

  test('offsets are a clean multiple of the height', () => {
    const { DETAIL_ITEM_LAYOUT, DETAIL_ROW_H } = rendered();
    for (const i of [0, 1, 7, 244]) {
      expect(DETAIL_ITEM_LAYOUT(null, i)).toEqual({
        length: DETAIL_ROW_H,
        offset: DETAIL_ROW_H * i,
        index: i,
      });
    }
  });
});

// The gate is the whole reason this is safe to ship. Nothing in the app sets
// allowFontScaling or maxFontSizeMultiplier, so an enlarged system font grows
// the meta column past the art and the row with it — and a constant that lies
// to the virtualizer is worse than no constant at all.
describe('an enlarged system font disarms the whole thing', () => {
  test('no layout function is exported', () => {
    expect(exportsAt(1.5).DETAIL_ITEM_LAYOUT).toBeUndefined();
    expect(exportsAt(1).DETAIL_ITEM_LAYOUT).toBeInstanceOf(Function);
  });

  // The rendered half of this case cannot live here: mounting a row under a
  // second scale needs a second module registry, and that means a second copy
  // of React. The export being undefined is what actually disarms the list —
  // FlatList checks it for truthiness — so that is the assertion that matters.
});
