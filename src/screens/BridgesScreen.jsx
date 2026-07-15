import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { usePlayer } from '../playback/PlayerContext';
import { getBridge, getBridgeSuggestion } from '../api/bridges';
import {
  FROM_MOODS,
  TO_MOODS,
  BRIDGE_LANGS,
  MIN_STEPS,
  MAX_STEPS,
  MOOD_BRIDGES,
  loadCfg,
  saveCfg,
} from '../lib/bridges';
import { showToast } from '../lib/toast';
import { Icon } from '../components/Icon';
import { BounceScrollView } from '../components/ui/Bounce';
import { PressScale } from '../components/ui/PressScale';
import { ScreenFade } from '../components/ui/ScreenFade';
import { BridgeItinerary } from '../components/bridges/BridgeItinerary';
import { fonts, label, radii } from '../theme/tokens';

// Ported from web DesktopBridges.jsx: gradual paths between feelings. A
// clairvoyant hero reads your mood + proposes tonight's journey, a builder
// threads any from→to path (curate → begin), and four classic presets round
// it out. The server (LLM plan + 3-tier catalog assembly) is already live.

function MoodPicker({ heading, moods, value, badgeKey, onPick, t }) {
  return (
    <View style={styles.moodcol}>
      <Text style={[label(9), { color: t.inkFaint }]}>{heading}</Text>
      <View style={styles.moodgrid}>
        {moods.map(m => {
          const on = value === m.key;
          return (
            <Pressable
              key={m.key}
              accessibilityRole="button"
              accessibilityLabel={m.key}
              accessibilityState={{ selected: on }}
              onPress={() => onPick(m.key)}
              style={[
                styles.moodchip,
                { borderColor: on ? m.color : t.line },
                on && { backgroundColor: `${m.color}22` },
              ]}
            >
              <View style={styles.moodchipHead}>
                <Text
                  style={[
                    styles.moodchipKey,
                    { color: on ? m.color : t.ink },
                  ]}
                >
                  {m.key}
                </Text>
                {badgeKey === m.key && (
                  <View style={[styles.badge, { backgroundColor: t.accent }]}>
                    <Text style={[styles.badgeText, { color: t.bg }]}>you</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.moodchipHint, { color: t.inkFaint }]}>
                {m.hint}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function BridgesScreen({ navigation }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const player = usePlayer();

  const [cfg, setCfg] = useState(loadCfg);
  const [loadingId, setLoadingId] = useState(null); // preset one-tap builds
  const [suggestion, setSuggestion] = useState(null);
  const [suggestGone, setSuggestGone] = useState(false);
  const [heroBridge, setHeroBridge] = useState(null); // { narrative, tracks }
  const [built, setBuilt] = useState(null); // { narrative, tracks }
  const [building, setBuilding] = useState(false);
  // A live view of cfg + an in-flight guard so an async curate can (a) reject
  // its own result if the mood/length changed while it was in flight, and (b)
  // ignore a double-tap without waiting for the building state to re-render.
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const buildingRef = useRef(false);

  useEffect(() => saveCfg(cfg), [cfg]);

  useEffect(() => {
    const ctl = new AbortController();
    (async () => {
      try {
        const s = await getBridgeSuggestion({ signal: ctl.signal });
        setSuggestion(s);
        const b = await getBridge({
          from: s.from,
          to: s.to,
          steps: s.steps ?? 5,
          langs: s.langs ?? [],
          signal: ctl.signal,
        });
        if (b.tracks?.length) {
          setHeroBridge(b);
        } else {
          // 200 with no playable tracks (sparse affinity) — don't leave the
          // hero spinning "curating" forever; let the builder lead instead.
          setSuggestGone(true);
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          setSuggestGone(true);
        }
      }
    })();
    return () => ctl.abort();
  }, []);

  const play = (tracks, from, to) => {
    player.playQueue(tracks, 0, `${from} → ${to}`);
    player.ui?.openPlayer?.();
  };

  const beginHero = () => {
    if (heroBridge?.tracks?.length && suggestion) {
      play(heroBridge.tracks, suggestion.from, suggestion.to);
    }
  };

  const curate = async () => {
    if (buildingRef.current) {
      return;
    }
    buildingRef.current = true;
    // Snapshot the moods/length this build is for — if the user changes them
    // mid-flight, the resolved (now stale) result must not land in `built`.
    const snap = {
      from: cfg.from,
      to: cfg.to,
      steps: cfg.steps,
      langs: cfg.langs.join(','),
    };
    setBuilding(true);
    try {
      const b = await getBridge({
        from: snap.from,
        to: snap.to,
        steps: snap.steps,
        langs: cfg.langs,
      });
      const now = cfgRef.current;
      if (
        now.from !== snap.from ||
        now.to !== snap.to ||
        now.steps !== snap.steps ||
        now.langs.join(',') !== snap.langs
      ) {
        return; // config moved on — drop this result
      }
      if (!b.tracks?.length) {
        showToast("couldn't curate that bridge.");
        return;
      }
      setBuilt(b);
    } catch (err) {
      showToast(`couldn't curate — ${err.message}`);
    } finally {
      buildingRef.current = false;
      setBuilding(false);
    }
  };

  const beginBuilt = () => {
    if (built?.tracks?.length) {
      play(built.tracks, cfg.from, cfg.to);
    }
  };

  // Any cfg change invalidates the curated itinerary back to the preview.
  const updateCfg = patch => {
    setBuilt(null);
    setCfg(c => ({ ...c, ...patch }));
  };
  const toggleLang = l => {
    setBuilt(null);
    setCfg(c => {
      if (l === 'mix') {
        return { ...c, langs: [] };
      }
      if (c.langs.includes(l)) {
        return { ...c, langs: c.langs.filter(x => x !== l) };
      }
      return { ...c, langs: [...c.langs, l].slice(-2) }; // 3rd pick drops oldest
    });
  };

  const beginPreset = async bridge => {
    if (loadingId) {
      return;
    }
    setLoadingId(bridge.id);
    try {
      const { tracks } = await getBridge({
        from: bridge.from,
        to: bridge.to,
        steps: bridge.steps,
        langs: cfg.langs,
      });
      if (!tracks?.length) {
        showToast("couldn't curate that bridge.");
        return;
      }
      play(tracks, bridge.from, bridge.to);
    } catch (err) {
      showToast(`couldn't load bridge — ${err.message}`);
    } finally {
      setLoadingId(null);
    }
  };

  const sameMood = cfg.from === cfg.to;
  const customBridge = { id: 'custom', from: cfg.from, to: cfg.to, steps: cfg.steps };

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

          <Text style={[label(11), { color: t.inkFaint }]}>
            gradual paths between feelings
          </Text>
          <Text style={[styles.hero, { color: t.ink }]}>
            from here{'\n'}to there.
          </Text>
          <Text style={[styles.sub, { color: t.inkSoft }]}>
            songs threaded so the mood shifts gradually. build your own path, or
            let the bridge read you.
          </Text>

          {/* The clairvoyant hero */}
          {!suggestGone && (
            <View
              style={[
                styles.heroCard,
                { backgroundColor: t.surface, borderColor: t.line },
              ]}
            >
              <Text style={[label(10), { color: t.accent }]}>
                the bridge already knows
              </Text>
              {suggestion ? (
                <>
                  {!!suggestion.reason && (
                    <Text style={[styles.heroReason, { color: t.ink }]}>
                      {suggestion.reason}
                    </Text>
                  )}
                  <BridgeItinerary
                    bridge={{
                      id: 'hero',
                      from: suggestion.from,
                      to: suggestion.to,
                      steps: suggestion.steps ?? 5,
                    }}
                    tracks={heroBridge?.tracks}
                    narrative={heroBridge?.narrative}
                    loading={!heroBridge}
                    cta={
                      heroBridge?.tracks?.length
                        ? { label: 'begin →', onPress: beginHero }
                        : null
                    }
                    t={t}
                  />
                </>
              ) : (
                <Text style={[styles.heroReason, { color: t.inkFaint }]}>
                  reading the moment…
                </Text>
              )}
            </View>
          )}

          {/* Build your own */}
          <Text style={[label(11), styles.blockLabel, { color: t.inkFaint }]}>
            build your own
          </Text>
          <MoodPicker
            heading="where you are"
            moods={FROM_MOODS}
            value={cfg.from}
            badgeKey={suggestion?.mood ? suggestion.from : null}
            onPick={k => updateCfg({ from: k })}
            t={t}
          />
          <MoodPicker
            heading="where you want to be"
            moods={TO_MOODS}
            value={cfg.to}
            badgeKey={null}
            onPick={k => updateCfg({ to: k })}
            t={t}
          />

          <Text style={[label(9), styles.langLabel, { color: t.inkFaint }]}>
            languages
          </Text>
          <View style={styles.langrow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="your mix"
              onPress={() => toggleLang('mix')}
              style={[
                styles.langchip,
                { borderColor: cfg.langs.length === 0 ? t.accent : t.line },
                cfg.langs.length === 0 && { backgroundColor: t.accentSoft },
              ]}
            >
              <Text
                style={[
                  styles.langText,
                  { color: cfg.langs.length === 0 ? t.accent : t.inkSoft },
                ]}
              >
                your mix
              </Text>
            </Pressable>
            {BRIDGE_LANGS.map(l => {
              const on = cfg.langs.includes(l);
              return (
                <Pressable
                  key={l}
                  accessibilityRole="button"
                  accessibilityLabel={l}
                  accessibilityState={{ selected: on }}
                  onPress={() => toggleLang(l)}
                  style={[
                    styles.langchip,
                    { borderColor: on ? t.accent : t.line },
                    on && { backgroundColor: t.accentSoft },
                  ]}
                >
                  <Text
                    style={[styles.langText, { color: on ? t.accent : t.inkSoft }]}
                  >
                    {l}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.steps}>
            <Text style={[label(10), { color: t.inkFaint }]}>length</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="fewer tracks"
              disabled={cfg.steps <= MIN_STEPS}
              onPress={() =>
                updateCfg({ steps: Math.max(MIN_STEPS, cfg.steps - 1) })
              }
              style={[
                styles.stepBtn,
                { borderColor: t.line },
                cfg.steps <= MIN_STEPS && styles.dim,
              ]}
            >
              <Text style={[styles.stepSign, { color: t.ink }]}>−</Text>
            </Pressable>
            <Text style={[styles.stepVal, { color: t.ink }]}>
              {cfg.steps} tracks
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="more tracks"
              disabled={cfg.steps >= MAX_STEPS}
              onPress={() =>
                updateCfg({ steps: Math.min(MAX_STEPS, cfg.steps + 1) })
              }
              style={[
                styles.stepBtn,
                { borderColor: t.line },
                cfg.steps >= MAX_STEPS && styles.dim,
              ]}
            >
              <Text style={[styles.stepSign, { color: t.ink }]}>+</Text>
            </Pressable>
          </View>

          {sameMood ? (
            <Text style={[styles.hint, { color: t.inkSoft }]}>
              pick two different moods and aura threads a path between them.
            </Text>
          ) : (
            <View
              style={[
                styles.previewCard,
                { backgroundColor: t.surface, borderColor: t.line },
              ]}
            >
              <BridgeItinerary
                bridge={customBridge}
                tracks={built?.tracks}
                narrative={built?.narrative}
                loading={building}
                cta={
                  building
                    ? null
                    : built?.tracks?.length
                      ? { label: 'begin →', onPress: beginBuilt }
                      : { label: 'curate this path →', onPress: curate }
                }
                t={t}
              />
            </View>
          )}

          {/* Classic paths */}
          <Text style={[label(11), styles.blockLabel, { color: t.inkFaint }]}>
            classic paths
          </Text>
          {MOOD_BRIDGES.map(b => (
            <PressScale
              key={b.id}
              accessibilityRole="button"
              accessibilityLabel={`begin ${b.from} to ${b.to}`}
              onPress={() => beginPreset(b)}
              style={[
                styles.presetCard,
                { backgroundColor: t.surface, borderColor: t.line },
                loadingId === b.id && styles.dim,
              ]}
            >
              <View style={styles.presetHead}>
                <Text style={[label(9), { color: t.inkFaint }]}>
                  {b.steps} tracks · {b.eta}
                </Text>
                <Text style={[label(9.5), { color: t.accent }]}>
                  {loadingId === b.id ? 'loading…' : 'begin →'}
                </Text>
              </View>
              <BridgeItinerary
                bridge={b}
                cta={null}
                t={t}
              />
            </PressScale>
          ))}
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
  sub: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
  },
  heroCard: {
    borderWidth: 1,
    borderRadius: radii.card,
    padding: 16,
    marginTop: 22,
    gap: 10,
  },
  heroReason: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 21,
  },
  blockLabel: { marginTop: 28, marginBottom: 12 },
  moodcol: { gap: 8, marginBottom: 16 },
  moodgrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  moodchip: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
    minWidth: 96,
  },
  moodchipHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  moodchipKey: { fontFamily: fonts.medium, fontSize: 15 },
  moodchipHint: { fontFamily: fonts.regular, fontSize: 11.5 },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  badgeText: {
    fontFamily: fonts.medium,
    fontSize: 8,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  langLabel: { marginBottom: 8 },
  langrow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  langchip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  langText: { fontFamily: fonts.medium, fontSize: 12 },
  steps: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 22,
  },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepSign: { fontFamily: fonts.regular, fontSize: 20, lineHeight: 22 },
  stepVal: { fontFamily: fonts.medium, fontSize: 15, minWidth: 74 },
  dim: { opacity: 0.4 },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 20,
    paddingVertical: 12,
  },
  previewCard: {
    borderWidth: 1,
    borderRadius: radii.card,
    padding: 16,
    marginTop: 18,
  },
  presetCard: {
    borderWidth: 1,
    borderRadius: radii.card,
    padding: 16,
    marginBottom: 12,
  },
  presetHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
});
