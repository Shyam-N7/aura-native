import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../theme/ThemeContext';
import { getWhy } from '../api/why';
import { getCurrentMood } from '../api/mood';
import { closeWhy, subscribeWhy } from '../lib/whySheet';
import { Sheet } from '../components/ui/Sheet';
import { AuraLoader } from '../components/ui/AuraLoader';
import { cleanTitle } from '../utils/title';
import { fonts, label } from '../theme/tokens';

// Ported from web WhyPanel.jsx: the curator's reasoning for a track — a
// headline, a short body, three matched-on dimensions with strength bars,
// the considered-and-ruled-out alternatives, and a confidence dial. Opened
// from the track actions menu; one instance mounts in App.

function ConfidenceDial({ progress, accent, track, ink }) {
  const size = 44;
  const r = 18;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <View style={styles.dialWrap}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={track}
          strokeWidth={2.5}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={accent}
          strokeWidth={2.5}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c * clamped} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text style={[styles.dialNum, { color: ink }]}>
        {Math.floor(clamped * 100)}
      </Text>
    </View>
  );
}

export function WhySheet() {
  const { t } = useTheme();
  const [track, setTrack] = useState(null);
  const [hit, setHit] = useState({ trackId: null, data: null, error: null });

  useEffect(() => subscribeWhy(setTrack), []);

  const trackId = track?.id;
  useEffect(() => {
    if (!trackId) {
      return undefined;
    }
    const ctl = new AbortController();
    // The mood snapshot sharpens the reasoning; only claim one when the
    // server is confident, otherwise let the endpoint reason mood-free.
    getCurrentMood({ signal: ctl.signal })
      .catch(() => null)
      .then(snap => {
        const mood =
          snap?.mood && snap.confidence >= 0.5 ? snap.mood : undefined;
        return getWhy({ trackId, mood, signal: ctl.signal });
      })
      .then(data => setHit({ trackId, data, error: null }))
      .catch(err => {
        if (err.name === 'AbortError') {
          return;
        }
        setHit({ trackId, data: null, error: err.message });
      });
    return () => ctl.abort();
  }, [trackId]);

  if (!track) {
    return null;
  }

  const status =
    hit.trackId === trackId
      ? hit.error
        ? 'error'
        : hit.data
          ? 'ok'
          : 'loading'
      : 'loading';
  const r = status === 'ok' ? hit.data : null;

  return (
    <Sheet
      onClose={closeWhy}
      closeLabel="close why"
      header={
        <View style={styles.head}>
          <View style={[styles.dot, { backgroundColor: t.accent }]} />
          <Text style={[label(10), { color: t.inkSoft }]}>why this song</Text>
          <Text
            numberOfLines={1}
            style={[styles.headTitle, { color: t.inkFaint }]}
          >
            {cleanTitle(track.title)}
          </Text>
        </View>
      }
    >
      {status === 'loading' && (
        <View style={styles.loading}>
          <AuraLoader label="reading the room" />
        </View>
      )}

      {status === 'error' && (
        <View style={styles.block}>
          <Text style={[label(9), { color: t.inkFaint }]}>
            couldn't reason
          </Text>
          <Text style={[styles.errorText, { color: t.inkSoft }]}>
            {hit.error}
          </Text>
        </View>
      )}

      {status === 'ok' && (
        <>
          <View style={styles.block}>
            <Text style={[styles.headline, { color: t.ink }]}>
              {r.headline}
            </Text>
            <Text style={[styles.body, { color: t.inkSoft }]}>{r.body}</Text>
          </View>

          <View style={styles.block}>
            <Text style={[label(9), { color: t.inkFaint }]}>matched on</Text>
            {(r.dimensions ?? []).map((d, i) => (
              <View
                key={i}
                style={[styles.dimension, { borderTopColor: t.line }]}
              >
                <View style={styles.dimensionRow}>
                  <Text style={[styles.dimensionLabel, { color: t.ink }]}>
                    {d.label}
                  </Text>
                  <Text style={[label(10), { color: t.inkFaint }]}>
                    {Math.floor((d.strength ?? 0) * 100)}%
                  </Text>
                </View>
                <Text style={[styles.dimensionValue, { color: t.inkSoft }]}>
                  {d.value}
                </Text>
                <View style={[styles.bar, { backgroundColor: t.line }]}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        backgroundColor: t.accent,
                        width: `${Math.max(0, Math.min(1, d.strength ?? 0)) * 100}%`,
                      },
                    ]}
                  />
                </View>
              </View>
            ))}
          </View>

          {(r.considered?.length ?? 0) > 0 && (
            <View style={[styles.block, styles.hairlineTop, { borderTopColor: t.line }]}>
              <Text style={[label(9), { color: t.inkFaint }]}>
                considered · ruled out
              </Text>
              {r.considered.map((c, i) => (
                <View key={i} style={styles.considered}>
                  <Text style={[styles.consideredTitle, { color: t.ink }]}>
                    {c.title}
                    <Text style={{ color: t.inkSoft }}> — {c.artist}</Text>
                  </Text>
                  <Text style={[label(9.5), { color: t.inkFaint }]}>
                    {c.why}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.confidenceRow}>
            <Text style={[label(9), { color: t.inkFaint }]}>confidence</Text>
            <ConfidenceDial
              progress={r.confidence ?? 0}
              accent={t.accent}
              track={t.line}
              ink={t.ink}
            />
          </View>
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 10,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  headTitle: {
    flex: 1,
    textAlign: 'right',
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  loading: { paddingVertical: 48, alignItems: 'center' },
  block: { gap: 10, paddingBottom: 18 },
  errorText: {
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 22,
  },
  headline: {
    fontFamily: fonts.semibold,
    fontSize: 27,
    lineHeight: 30,
    letterSpacing: -0.54,
    marginTop: 4,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
  },
  dimension: {
    borderTopWidth: 1,
    paddingTop: 10,
    gap: 4,
  },
  dimensionRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  dimensionLabel: { fontFamily: fonts.medium, fontSize: 17 },
  dimensionValue: { fontFamily: fonts.regular, fontSize: 12.5 },
  bar: {
    height: 2,
    borderRadius: 1,
    marginTop: 6,
    overflow: 'hidden',
  },
  barFill: { height: 2, borderRadius: 1 },
  hairlineTop: { borderTopWidth: 1, paddingTop: 14 },
  considered: { gap: 3 },
  consideredTitle: { fontFamily: fonts.medium, fontSize: 15 },
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
  },
  dialWrap: { alignItems: 'center', justifyContent: 'center' },
  dialNum: {
    position: 'absolute',
    fontFamily: fonts.medium,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
});
