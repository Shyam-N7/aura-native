import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, {
  Circle,
  Line,
  Path,
  Polygon,
  Text as SvgText,
} from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { getSonicDna } from '../api/sonicDna';
import { Icon } from '../components/Icon';
import { BounceScrollView } from '../components/ui/Bounce';
import { AuraLoader } from '../components/ui/AuraLoader';
import { PressScale } from '../components/ui/PressScale';
import { ScreenFade } from '../components/ui/ScreenFade';
import { fonts, label, radii } from '../theme/tokens';

// Ported from web DesktopDna.jsx: the listening fingerprint — a six-axis
// radar, per-axis bars, this-month stat cards, and top moods. Two web client
// bugs fixed rather than replicated: the unavailable state reads eventsSeen
// (the server never sends `seen`), and moods show their real play counts
// (the server sends {label, count} — the web's `share`% rendered as NaN).

function Radar({ axes, size, line, accent, inkSoft }) {
  const n = axes.length;
  if (n < 3) {
    return null;
  }
  const r = size * 0.36;
  const cx = size / 2;
  const cy = size / 2;
  const pt = (i, v) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r * v, cy + Math.sin(a) * r * v];
  };
  const userPath =
    axes
      .map((ax, i) => pt(i, ax.v ?? 0))
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
      .join(' ') + ' Z';
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {[0.25, 0.5, 0.75, 1].map((s, i) => (
        <Polygon
          key={i}
          points={axes.map((_, j) => pt(j, s).join(',')).join(' ')}
          stroke={line}
          strokeWidth={0.8}
          fill="none"
        />
      ))}
      {axes.map((_, i) => {
        const [x, y] = pt(i, 1);
        return (
          <Line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={line} strokeWidth={0.6} />
        );
      })}
      <Path
        d={userPath}
        fill={accent}
        fillOpacity={0.18}
        stroke={accent}
        strokeWidth={1.6}
      />
      {axes.map((ax, i) => {
        const [x, y] = pt(i, ax.v ?? 0);
        return <Circle key={i} cx={x} cy={y} r={3.5} fill={accent} />;
      })}
      {axes.map((ax, i) => {
        const [x, y] = pt(i, 1.22);
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        const cos = Math.cos(a);
        const anchor = cos < -0.3 ? 'end' : cos > 0.3 ? 'start' : 'middle';
        return (
          <SvgText
            key={i}
            x={x}
            y={y + 3}
            textAnchor={anchor}
            fill={inkSoft}
            fontFamily={fonts.medium}
            fontSize={9}
            letterSpacing={0.7}
          >
            {(ax.label ?? '').toUpperCase()}
          </SvgText>
        );
      })}
    </Svg>
  );
}

function StatCard({ k, v, sub, t }) {
  return (
    <View
      style={[
        styles.statCard,
        { backgroundColor: t.surface, borderColor: t.line },
      ]}
    >
      <Text style={[label(9), { color: t.inkFaint }]}>{k}</Text>
      <Text style={[styles.statValue, { color: t.ink }]}>{v}</Text>
      <Text style={[label(10), { color: t.inkSoft }]}>{sub}</Text>
    </View>
  );
}

export default function DnaScreen({ navigation }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const [hit, setHit] = useState({ data: null, error: null });
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';

  useEffect(() => {
    const ctl = new AbortController();
    getSonicDna({ signal: ctl.signal })
      .then(data => setHit({ data, error: null }))
      .catch(err => {
        if (err.name === 'AbortError') {
          return;
        }
        setHit({ data: null, error: err.message });
      });
    return () => ctl.abort();
  }, []);

  const dna = hit.data;
  const radarSize = Math.min(winW - 44, 320);

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <ScreenFade>
        <BounceScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <PressScale
            accessibilityRole="button"
            accessibilityLabel="back"
            onPress={() => navigation.goBack()}
            hitSlop={10}
            style={styles.back}
          >
            <Icon name="chevron-left" size={22} color={t.ink} />
          </PressScale>

          <Text style={[label(10), { color: t.inkFaint }]}>
            Sonic DNA · a fingerprint of you
          </Text>
          <Text style={[styles.hero, { color: t.ink }]}>
            You, as a{'\n'}fingerprint.
          </Text>
          {!!dna?.signature && (
            <Text style={[label(10), styles.signature, { color: t.inkFaint }]}>
              {dna.signature}
              {dna.shift ? ` · ${dna.shift}` : ''}
            </Text>
          )}

          {status === 'loading' && (
            <View style={styles.center}>
              <AuraLoader label="Building your sonic DNA" />
            </View>
          )}

          {status === 'error' && (
            <Text style={[styles.errorText, { color: t.inkSoft }]}>
              Couldn't load — {hit.error}
            </Text>
          )}

          {status === 'ok' && !dna.available && (
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: t.ink }]}>
                Not enough listening yet.
              </Text>
              <Text style={[styles.emptyBody, { color: t.inkSoft }]}>
                Play a few sessions before the fingerprint surfaces.
                {dna.threshold && dna.eventsSeen != null
                  ? ` You're at ${dna.eventsSeen}/${dna.threshold} plays so far.`
                  : ''}
              </Text>
            </View>
          )}

          {status === 'ok' && dna.available && (
            <>
              <View style={styles.radarWrap}>
                <Radar
                  axes={dna.axes ?? []}
                  size={radarSize}
                  line={t.line}
                  accent={t.accent}
                  inkSoft={t.inkSoft}
                />
              </View>

              <View style={styles.axes}>
                {(dna.axes ?? []).map((a, i) => (
                  <View key={i} style={styles.axis}>
                    <View style={styles.axisMeta}>
                      <Text style={[styles.axisName, { color: t.ink }]}>
                        {a.label}
                      </Text>
                      <Text style={[label(9), { color: t.inkFaint }]}>
                        {a.range}
                      </Text>
                    </View>
                    <View style={[styles.axisBar, { backgroundColor: t.line }]}>
                      <View
                        style={[
                          styles.axisFill,
                          {
                            backgroundColor: t.accent,
                            width: `${Math.max(0, Math.min(1, a.v ?? 0)) * 100}%`,
                          },
                        ]}
                      />
                    </View>
                    <Text style={[label(10), styles.axisNum, { color: t.inkSoft }]}>
                      {Math.round((a.v ?? 0) * 100)}
                    </Text>
                  </View>
                ))}
              </View>

              {!!dna.thisMonth && (
                <View style={styles.block}>
                  <Text style={[label(10), { color: t.inkFaint }]}>
                    This month · in numbers
                  </Text>
                  <View style={styles.stats}>
                    <StatCard k="Hours" v={dna.thisMonth.hours ?? '—'} sub="Listened" t={t} />
                    <StatCard k="Artists" v={dna.thisMonth.artists ?? '—'} sub="Unique artists" t={t} />
                    <StatCard k="New" v={dna.thisMonth.newTracks ?? '—'} sub="New tracks" t={t} />
                    <StatCard k="Returns" v={dna.thisMonth.returns ?? '—'} sub="Returning" t={t} />
                  </View>
                </View>
              )}

              {(dna.topMoods?.length ?? 0) > 0 && (
                <View style={styles.block}>
                  <Text style={[label(10), { color: t.inkFaint }]}>
                    Top moods · this month
                  </Text>
                  <View style={styles.moods}>
                    {dna.topMoods.map((m, i) => (
                      <View key={i} style={styles.mood}>
                        <Text style={[styles.moodLabel, { color: t.ink }]}>
                          {m.label}
                        </Text>
                        <Text style={[label(9.5), { color: t.inkFaint }]}>
                          {m.count} plays
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </>
          )}
        </BounceScrollView>
      </ScreenFade>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 22 },
  back: {
    width: 38,
    height: 38,
    justifyContent: 'center',
    marginLeft: -8,
    marginBottom: 6,
  },
  hero: {
    fontFamily: fonts.regular,
    fontSize: 34,
    lineHeight: 36,
    letterSpacing: -1.02,
    marginTop: 8,
  },
  signature: { marginTop: 12 },
  center: { paddingVertical: 48, alignItems: 'center' },
  errorText: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 21,
    paddingVertical: 24,
  },
  empty: { paddingVertical: 32, gap: 8 },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 18 },
  emptyBody: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  radarWrap: { alignItems: 'center', marginTop: 20 },
  axes: { marginTop: 18, gap: 14 },
  axis: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  axisMeta: { width: 108, gap: 2 },
  axisName: { fontFamily: fonts.medium, fontSize: 14 },
  axisBar: {
    flex: 1,
    height: 2,
    borderRadius: 1,
    overflow: 'hidden',
  },
  axisFill: { height: 2, borderRadius: 1 },
  axisNum: { width: 26, textAlign: 'right' },
  block: { marginTop: 28, gap: 14 },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statCard: {
    width: '47%',
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: 14,
    gap: 6,
  },
  statValue: { fontFamily: fonts.semibold, fontSize: 24 },
  moods: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  mood: { gap: 3 },
  moodLabel: { fontFamily: fonts.medium, fontSize: 16 },
});
