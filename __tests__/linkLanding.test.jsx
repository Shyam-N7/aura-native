import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
// Same graft as deepLinkGuard.test.jsx: node's URL with RN's eager-decode
// semantics, so the classifier's throw-safety is proven against what ships.
import {
  classifyLink,
  landingLabel,
  showLanding,
  hideLanding,
  subscribeLanding,
} from '../src/lib/linkLanding';
import { LinkLanding } from '../src/components/LinkLanding';
import { ThemeProvider } from '../src/theme/ThemeContext';

const nodeURL = global.URL;
class DeviceLikeURL extends nodeURL {
  get searchParams() {
    this.search
      .replace(/^\?/, '')
      .split('&')
      .filter(Boolean)
      .forEach(pair =>
        pair
          .split('=')
          .forEach(part => decodeURIComponent(part.replace(/\+/g, ' '))),
      );
    return super.searchParams;
  }
}

beforeEach(() => {
  global.URL = DeviceLikeURL;
  hideLanding();
});
afterEach(() => {
  global.URL = nodeURL;
});

const BASE = 'https://www.aurafm.live';

describe('classifyLink — the one parser', () => {
  test('the full shape table', () => {
    expect(classifyLink(`${BASE}/t/x1`)).toEqual({ kind: 'song', trackId: 'x1', at: null });
    expect(classifyLink(`${BASE}/t/x1?src=share&at=84`)).toEqual({ kind: 'moment', trackId: 'x1', at: 84 });
    // Invalid ?at degrades to a plain song, never drops the link.
    expect(classifyLink(`${BASE}/t/x1?at=0`).kind).toBe('song');
    expect(classifyLink(`${BASE}/t/x1?at=-5`).kind).toBe('song');
    expect(classifyLink(`${BASE}/t/x1?at=abc`).kind).toBe('song');
    expect(classifyLink(`${BASE}/p/pub1`)).toEqual({ kind: 'playlist', publicId: 'pub1' });
    expect(classifyLink(`${BASE}/playlists?join=tok`)).toEqual({ kind: 'invite', token: 'tok' });
    // Empty ids are nothing, not a landing with nowhere to go.
    expect(classifyLink(`${BASE}/t/`)).toBeNull();
    expect(classifyLink(`${BASE}/p/`)).toBeNull();
    expect(classifyLink(`${BASE}/somewhere`)).toBeNull();
  });

  test('hostile input never throws and never classifies', () => {
    expect(classifyLink(`${BASE}/t/x1?at=%E0%A4`)).toBeNull();   // truncated escape
    expect(classifyLink('https://evil.com/t/x1')).toBeNull();
    expect(classifyLink('https://aurafm.live.evil.com/t/x1')).toBeNull();
    expect(classifyLink('http://www.aurafm.live/t/x1')).toBeNull(); // scheme pinned
    expect(classifyLink('')).toBeNull();
    expect(classifyLink(null)).toBeNull();
    expect(classifyLink('not a url')).toBeNull();
  });
});

describe('landingLabel', () => {
  test('each kind names its errand; the moment carries its stamp', () => {
    expect(landingLabel({ kind: 'song' })).toBe('opening the song');
    expect(landingLabel({ kind: 'moment', at: 84 })).toBe('starting from 1:24');
    expect(landingLabel({ kind: 'playlist' })).toBe('opening the playlist');
    expect(landingLabel({ kind: 'invite' })).toBe('joining the playlist');
  });
});

describe('the bus', () => {
  test('a show before the host mounts replays to the first subscriber', () => {
    showLanding({ kind: 'song', trackId: 'x' });
    const seen = [];
    const un = subscribeLanding(e => seen.push(e));
    expect(seen).toHaveLength(1);
    expect(seen[0].kind).toBe('song');
    un();
  });

  test('an expired pending show is dropped, and hide clears it', () => {
    jest.useFakeTimers();
    showLanding({ kind: 'song', trackId: 'x' });
    jest.advanceTimersByTime(11_000);
    jest.setSystemTime(Date.now() + 11_000);
    const seen = [];
    const un = subscribeLanding(e => seen.push(e));
    expect(seen).toHaveLength(0);
    un();
    jest.useRealTimers();

    showLanding({ kind: 'song', trackId: 'x' });
    hideLanding();
    const later = [];
    const un2 = subscribeLanding(e => later.push(e));
    expect(later).toHaveLength(0);
    un2();
  });
});

describe('the host', () => {
  const render = async node => {
    let tree;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
    });
    return tree;
  };
  const texts = n =>
    n == null ? '' : typeof n === 'string' ? n : Array.isArray(n) ? n.map(texts).join('') : texts(n.children);

  test('shows the errand, hides on the bus, and the 8s valve self-rescues', async () => {
    jest.useFakeTimers();
    const tree = await render(<LinkLanding />);
    await ReactTestRenderer.act(async () => {
      showLanding({ kind: 'moment', at: 84 });
    });
    expect(texts(tree.toJSON())).toContain('starting from 1:24');

    await ReactTestRenderer.act(async () => {
      hideLanding();
    });
    // The unmount rides a timer scheduled by the effect the hide triggered —
    // advance in a second act so the timer exists before the clock moves.
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(texts(tree.toJSON())).not.toContain('starting from 1:24');

    // The safety valve: a landing nobody dismisses dismisses itself.
    await ReactTestRenderer.act(async () => {
      showLanding({ kind: 'song', trackId: 'x' });
    });
    expect(texts(tree.toJSON())).toContain('opening the song');
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(8100);
    });
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(texts(tree.toJSON())).not.toContain('opening the song');
    await ReactTestRenderer.act(async () => tree.unmount());
    jest.useRealTimers();
  });
});
