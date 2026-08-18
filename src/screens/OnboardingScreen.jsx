import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  SlideInLeft,
  SlideInRight,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '../theme/ThemeContext';
import { PressScale } from '../components/ui/PressScale';
import { TrackArt } from '../components/TrackRow';
import { Icon } from '../components/Icon';
import { AuraLoader } from '../components/ui/AuraLoader';
import { getDiscoverHome } from '../api/discover';
import { getArtist } from '../api/artists';
import { PRIMARY_LANGUAGES, MORE_LANGUAGES } from '../data/languages';
import { SEED_ARTIST_FALLBACK } from '../data/seedArtists';
import { setSeedArtists, setSeedSignals, markOnboarded } from '../lib/onboarding';
import { fonts, label } from '../theme/tokens';

// First-run "pick three" flow — the web OnboardingScreen reimagined for mobile:
// a full-screen stepper, one panel at a time (language → mood → artists). The
// web's gooey chip-melt is DOM/CSS-bound and doesn't port, so the motion here is
// clean slide-in panels + spring selections. The data contract is unchanged:
// buildTiles ranks the artist pool, the six mood keys and the seed writers are
// the same, so home personalizes exactly as it does on the web.
const MIN_PICKS = 3; // minimum artists to finish; no upper cap
const MAX_TILES = 12; // first page of the artist grid

const STEPS = [
  { key: 'language', label: 'language', title: 'What do you listen to?' },
  { key: 'mood', label: 'mood', title: 'How do you feel?' },
  { key: 'artists', label: 'artists', title: 'Pick a few you love' },
];

// Six moods. `key` is the seed value home reads — unchanged from the web. `tint`
// is the lighter stop of the web's swatch gradient; the glyph says what the mood
// feels like. Labels/subs are plain-lowercase for the app's voice.
const MOODS = [
  { key: 'focused', label: 'Focus', sub: 'For concentration', tint: '#6e85a3', glyph: 'focused' },
  { key: 'unwound', label: 'Chill', sub: 'Wind down', tint: '#c4a36e', glyph: 'unwound' },
  { key: 'in-motion', label: 'Energy', sub: 'Get pumped', tint: '#c47554', glyph: 'in-motion' },
  { key: 'late-night', label: 'Late night', sub: 'After-hours', tint: '#4f7a62', glyph: 'late-night' },
  { key: 'curious', label: 'Discover', sub: 'Try new music', tint: '#8970a0', glyph: 'curious' },
  { key: 'remembering', label: 'Throwback', sub: 'Old favorites', tint: '#b08e6a', glyph: 'remembering' },
];

const GLYPH_COLOR = 'rgba(255,255,255,0.9)';

// Small line-art mood glyph, drawn in the centre of each swatch (ported from the
// web SVGs, static — no keyframes).
function MoodGlyph({ kind }) {
  switch (kind) {
    case 'focused':
      return (
        <Svg width={22} height={22} viewBox="0 0 22 22" fill="none">
          <Circle cx={11} cy={11} r={8.5} stroke={GLYPH_COLOR} strokeWidth={1} opacity={0.55} />
          <Circle cx={11} cy={11} r={4.5} stroke={GLYPH_COLOR} strokeWidth={1} opacity={0.7} />
          <Circle cx={11} cy={11} r={1.6} fill={GLYPH_COLOR} />
        </Svg>
      );
    case 'unwound':
      return (
        <Svg width={22} height={22} viewBox="0 0 22 22" fill="none">
          <Path d="M3 13 Q11 5 19 13" stroke={GLYPH_COLOR} strokeWidth={1.2} strokeLinecap="round" />
          <Circle cx={11} cy={9.5} r={1.2} fill={GLYPH_COLOR} opacity={0.7} />
        </Svg>
      );
    case 'in-motion':
      return (
        <Svg width={22} height={22} viewBox="0 0 22 22" fill="none">
          <Path d="M3 11 H17 M12 6 L17 11 L12 16" stroke={GLYPH_COLOR} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
          <Path d="M2 7.5 H8" stroke={GLYPH_COLOR} strokeWidth={1} strokeLinecap="round" opacity={0.5} />
          <Path d="M2 14.5 H8" stroke={GLYPH_COLOR} strokeWidth={1} strokeLinecap="round" opacity={0.5} />
        </Svg>
      );
    case 'late-night':
      return (
        <Svg width={22} height={22} viewBox="0 0 22 22" fill="none">
          <Path d="M16 11 a6 6 0 1 1 -6 -6 a5 5 0 0 0 6 6 z" fill={GLYPH_COLOR} opacity={0.9} />
          <Circle cx={17} cy={6} r={0.7} fill={GLYPH_COLOR} opacity={0.6} />
        </Svg>
      );
    case 'curious':
      return (
        <Svg width={22} height={22} viewBox="0 0 22 22" fill="none">
          <Path d="M11 2 L12 9 L19 11 L12 13 L11 20 L10 13 L3 11 L10 9 Z" fill={GLYPH_COLOR} />
        </Svg>
      );
    case 'remembering':
      return (
        <Svg width={22} height={22} viewBox="0 0 22 22" fill="none">
          <Path d="M5 14 a6 6 0 1 1 5 4" stroke={GLYPH_COLOR} strokeWidth={1.2} strokeLinecap="round" fill="none" />
          <Path d="M5 14 L3.5 11 M5 14 L8 13" stroke={GLYPH_COLOR} strokeWidth={1.2} strokeLinecap="round" />
        </Svg>
      );
    default:
      return null;
  }
}

// Session cache of real artist photos keyed by name. The grid is built from
// trending TRACKS (song covers only), so each tile lazily upgrades to the
// artist's actual photo. undefined = in flight, null = none (keep the cover).
const artistImgCache = new Map();

function buildTiles(pool) {
  // Recurrence across the pool is the popularity proxy (the catalog has no
  // top-artists feed). Dedup by artist, rank by count, then backfill the
  // curated seed names so the grid is always full.
  const seen = new Map();
  let order = 0;
  for (const track of pool) {
    const name = track.artist?.trim();
    if (!name) {
      continue;
    }
    const existing = seen.get(name);
    if (!existing) {
      seen.set(name, {
        name,
        language: track.language ?? null,
        imageUrl: track.imageUrl ?? null,
        sampleTrackId: track.id,
        count: 1,
        order: order++,
      });
    } else {
      existing.count += 1;
      if (!existing.imageUrl && track.imageUrl) {
        existing.imageUrl = track.imageUrl;
      }
    }
  }
  const fromPool = Array.from(seen.values()).sort(
    (a, b) => b.count - a.count || a.order - b.order,
  );
  const have = new Set(fromPool.map(x => x.name));
  const fill = SEED_ARTIST_FALLBACK.filter(x => !have.has(x.name));
  return [...fromPool, ...fill];
}

export function OnboardingScreen({ onDone }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();

  const [selectedLangs, setSelectedLangs] = useState(() => new Set());
  const [selectedMood, setSelectedMood] = useState(null);
  const [picks, setPicks] = useState(() => []);
  const [visibleCount, setVisibleCount] = useState(MAX_TILES);
  const [loadMoreClicked, setLoadMoreClicked] = useState(false);
  const [trending, setTrending] = useState([]);
  const [artistImages, setArtistImages] = useState(() => new Map());
  const [loadError, setLoadError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1); // 1 forward · -1 back
  const [showMoreLangs, setShowMoreLangs] = useState(false);

  // Pull trending on mount as the primary artist source; the seed fallback keeps
  // the grid full while it loads and if it fails.
  useEffect(() => {
    const ctl = new AbortController();
    getDiscoverHome({ signal: ctl.signal })
      .then(data => {
        setTrending(Array.isArray(data?.trending) ? data.trending : []);
        setLoadError(false);
      })
      .catch(err => {
        if (err?.name !== 'AbortError') {
          setLoadError(true);
        }
      });
    return () => ctl.abort();
  }, [reloadNonce]);

  // There used to be a `pool` prop merged in here as a secondary artist
  // source. App.jsx is the only call site and never passed one, so it
  // defaulted to [] on every render and this reduced to `trending` — the
  // seed fallback inside buildTiles is what actually fills the grid before
  // trending lands.
  const allTiles = useMemo(() => buildTiles(trending), [trending]);
  const tiles = useMemo(() => {
    if (selectedLangs.size === 0) {
      return allTiles;
    }
    // Float picked languages to the front — the grid stays broad, just relevant.
    const rank = x =>
      x.language && selectedLangs.has(String(x.language).toLowerCase()) ? 0 : 1;
    return [...allTiles].sort((a, b) => rank(a) - rank(b));
  }, [allTiles, selectedLangs]);
  const visibleTiles = tiles.slice(0, visibleCount);
  const canLoadMore = tiles.length > visibleCount;
  const imagesPending =
    step === 2 && visibleTiles.some(x => !artistImages.has(x.name));
  const loadingMore = loadMoreClicked && imagesPending;

  // On the artist step, upgrade each visible tile's song cover to the real
  // artist photo (cached per name, fetched once).
  useEffect(() => {
    if (step !== 2) {
      return undefined;
    }
    const pending = visibleTiles.filter(
      x => x.name && !artistImgCache.has(x.name),
    );
    if (!pending.length) {
      return undefined;
    }
    let cancelled = false;
    pending.forEach(x => artistImgCache.set(x.name, undefined));
    Promise.allSettled(
      pending.map(x =>
        getArtist(x.sampleTrackId ? { trackId: x.sampleTrackId } : { name: x.name })
          .then(a => artistImgCache.set(x.name, a?.image || null))
          .catch(() => artistImgCache.set(x.name, null)),
      ),
    ).then(() => {
      if (!cancelled) {
        setArtistImages(new Map(artistImgCache));
      }
    });
    return () => {
      cancelled = true;
    };
    // Re-run as more tiles reveal; visibleTiles is derived from these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, tiles, visibleCount]);

  const toggleLang = L =>
    setSelectedLangs(prev => {
      const next = new Set(prev);
      if (next.has(L)) {
        next.delete(L);
      } else {
        next.add(L);
      }
      return next;
    });
  const toggleMood = key => setSelectedMood(prev => (prev === key ? null : key));
  const togglePick = name =>
    setPicks(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name],
    );

  const moreLangSelected = MORE_LANGUAGES.some(l => selectedLangs.has(l));
  const langsExpanded = showMoreLangs || moreLangSelected;

  const valid = [selectedLangs.size > 0, !!selectedMood, picks.length >= MIN_PICKS];
  const isLast = step === STEPS.length - 1;
  const selectedMoodMeta = MOODS.find(m => m.key === selectedMood);

  // A step is reachable by its dot only when every step before it is satisfied.
  const canGoTo = i => valid.slice(0, i).every(Boolean);
  const goTo = i => {
    if (i === step || !(i < step || canGoTo(i))) {
      return;
    }
    setDir(i > step ? 1 : -1);
    setStep(i);
  };
  const goNext = () => {
    if (!valid[step]) {
      return;
    }
    if (isLast) {
      submit();
      return;
    }
    setDir(1);
    setStep(s => s + 1);
  };
  const goBack = () => {
    if (step === 0) {
      return;
    }
    setDir(-1);
    setStep(s => s - 1);
  };

  const submit = () => {
    const pickMeta = picks
      .map(name => allTiles.find(x => x.name === name))
      .filter(Boolean)
      .map(x => ({ name: x.name, language: x.language, sampleTrackId: x.sampleTrackId }));
    setSeedArtists(pickMeta);
    setSeedSignals({ languages: [...selectedLangs], mood: selectedMood });
    markOnboarded();
    onDone?.(pickMeta);
  };

  const metaLine = () => {
    if (step === 0) {
      return selectedLangs.size > 0
        ? `${selectedLangs.size} selected`
        : 'Choose one or more';
    }
    if (step === 1) {
      return selectedMoodMeta ? selectedMoodMeta.label : 'Pick one';
    }
    return picks.length < MIN_PICKS
      ? `${picks.length} of ${MIN_PICKS}`
      : `${picks.length} selected`;
  };

  const tile = Math.floor((width - 40 - 20) / 3); // 20 pad each side, 10 gaps ×2
  let entering;
  if (!reduced) {
    entering = dir > 0 ? SlideInRight.duration(280) : SlideInLeft.duration(280);
  }

  const langChip = L => {
    const on = selectedLangs.has(L);
    return (
      <PressScale
        key={L}
        accessibilityRole="button"
        accessibilityLabel={`${L}${on ? ', selected' : ''}`}
        accessibilityState={on ? { selected: true } : {}}
        onPress={() => toggleLang(L)}
        style={[
          styles.chip,
          { borderColor: on ? t.accent : t.line },
          on && { backgroundColor: t.accentCard },
        ]}
      >
        {on && <Icon name="check" size={13} color={t.accent} />}
        <Text style={[styles.chipText, { color: on ? t.accent : t.inkSoft }]}>
          {L}
        </Text>
      </PressScale>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top + 14 }]}>
      {/* progress: three segments filling by step */}
      <View style={styles.progress}>
        {STEPS.map((s, i) => (
          <View
            key={s.key}
            style={[
              styles.seg,
              { backgroundColor: i <= step ? t.accent : t.line },
            ]}
          />
        ))}
      </View>

      <View style={styles.header}>
        <Text style={[label(10), { color: t.accent }]}>Welcome to AURA</Text>

        <View style={styles.dots}>
          {STEPS.map((s, i) => {
            const done = valid[i] && i !== step;
            const active = i === step;
            const reachable = i < step || canGoTo(i);
            return (
              <PressScale
                key={s.key}
                accessibilityRole="button"
                accessibilityLabel={`step ${i + 1}, ${s.label}`}
                accessibilityState={{ selected: active, disabled: !reachable }}
                onPress={() => goTo(i)}
                style={[
                  styles.dot,
                  active && styles.dotActive,
                  { borderColor: active || done ? t.accent : t.line },
                  (active || done) && { backgroundColor: t.accent },
                ]}
              >
                {done ? (
                  <Icon name="check" size={11} color={t.bg} />
                ) : (
                  <Text
                    style={[
                      styles.dotNum,
                      { color: active ? t.bg : t.inkFaint },
                    ]}
                  >
                    {i + 1}
                  </Text>
                )}
              </PressScale>
            );
          })}
        </View>

        <Text style={[styles.title, { color: t.ink }]}>{STEPS[step].title}</Text>
        <Text style={[label(9), { color: t.inkFaint }]}>{metaLine()}</Text>
      </View>

      <Animated.View key={step} entering={entering} style={styles.panel}>
        {step === 0 && (
          <ScrollView
            contentContainerStyle={styles.scrollBody}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.chipRow}>
              {PRIMARY_LANGUAGES.map(L => langChip(L))}
              {langsExpanded && MORE_LANGUAGES.map(L => langChip(L))}
              {!moreLangSelected && (
                <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={showMoreLangs ? 'fewer languages' : 'more languages'}
                  onPress={() => setShowMoreLangs(v => !v)}
                  style={[styles.moreLangs, { borderColor: t.line }]}
                >
                  <Text style={[styles.chipText, { color: t.inkFaint }]}>
                    {showMoreLangs ? 'Fewer' : 'More'}
                  </Text>
                </PressScale>
              )}
            </View>
          </ScrollView>
        )}

        {step === 1 && (
          <ScrollView
            contentContainerStyle={styles.scrollBody}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.moodGrid}>
              {MOODS.map(m => {
                const on = selectedMood === m.key;
                return (
                  <PressScale
                    key={m.key}
                    accessibilityRole="button"
                    accessibilityLabel={`${m.label}${on ? ', selected' : ''}`}
                    accessibilityState={on ? { selected: true } : {}}
                    onPress={() => toggleMood(m.key)}
                    style={[
                      styles.moodCard,
                      { borderColor: on ? t.accent : t.line },
                      on && { backgroundColor: t.accentSoft },
                    ]}
                  >
                    <View style={[styles.swatch, { backgroundColor: m.tint }]}>
                      <MoodGlyph kind={m.glyph} />
                    </View>
                    <View style={styles.moodBody}>
                      <Text style={[styles.moodLabel, { color: t.ink }]}>
                        {m.label}
                      </Text>
                      <Text style={[styles.moodSub, { color: t.inkFaint }]}>
                        {m.sub}
                      </Text>
                    </View>
                  </PressScale>
                );
              })}
            </View>
          </ScrollView>
        )}

        {step === 2 && (
          <ScrollView
            contentContainerStyle={styles.scrollBody}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.grid}>
              {visibleTiles.map(x => {
                const on = picks.includes(x.name);
                const photo = artistImages.get(x.name) || x.imageUrl;
                return (
                  <PressScale
                    key={x.name}
                    accessibilityRole="button"
                    accessibilityLabel={`${x.name}${on ? ', selected' : ''}`}
                    accessibilityState={on ? { selected: true } : {}}
                    onPress={() => togglePick(x.name)}
                    style={{ width: tile }}
                  >
                    <View style={[styles.tileArt, { width: tile, height: tile }]}>
                      <TrackArt
                        track={{ title: x.name, imageUrl: photo }}
                        size={tile}
                        radius={12}
                      />
                      <View style={styles.tileScrim} />
                      <Text numberOfLines={1} style={styles.tileName}>
                        {x.name}
                      </Text>
                      {on && (
                        <>
                          <View
                            style={[styles.tileRing, { borderColor: t.accent }]}
                          />
                          <View
                            style={[styles.tileCheck, { backgroundColor: t.accent }]}
                          >
                            <Icon name="check" size={12} color={t.bg} />
                          </View>
                        </>
                      )}
                    </View>
                  </PressScale>
                );
              })}
              {tiles.length === 0 && (
                <View style={styles.empty}>
                  <Text style={[styles.emptyLine, { color: t.inkSoft }]}>
                    {loadError ? "Couldn't load artists" : 'No artists yet'}
                  </Text>
                  <PressScale
                    accessibilityRole="button"
                    accessibilityLabel="try again"
                    onPress={() => setReloadNonce(n => n + 1)}
                    style={[styles.retry, { borderColor: t.line }]}
                  >
                    <Text style={[styles.chipText, { color: t.inkSoft }]}>
                      Try again
                    </Text>
                  </PressScale>
                </View>
              )}
            </View>
            {canLoadMore &&
              (loadingMore ? (
                <AuraLoader label="Loading more" />
              ) : (
                <PressScale
                  accessibilityRole="button"
                  accessibilityLabel="load more artists"
                  onPress={() => {
                    setVisibleCount(c => c + 8);
                    setLoadMoreClicked(true);
                  }}
                  style={[styles.loadMore, { borderColor: t.line }]}
                >
                  <Icon name="plus" size={14} color={t.inkSoft} />
                  <Text style={[styles.chipText, { color: t.inkSoft }]}>
                    Load more artists
                  </Text>
                </PressScale>
              ))}
          </ScrollView>
        )}
      </Animated.View>

      <View style={[styles.foot, { paddingBottom: insets.bottom + 14 }]}>
        <PressScale
          accessibilityRole="button"
          accessibilityLabel="back"
          onPress={goBack}
          disabled={step === 0}
          style={[styles.backBtn, step === 0 && styles.footHidden]}
        >
          <Icon name="chevron-left" size={18} color={t.inkSoft} />
          <Text style={[styles.chipText, { color: t.inkSoft }]}>Back</Text>
        </PressScale>
        <View style={styles.footSpacer} />
        <PressScale
          accessibilityRole="button"
          accessibilityLabel="skip for now"
          onPress={submit}
          style={styles.skipBtn}
        >
          <Text style={[styles.chipText, { color: t.inkFaint }]}>
            Skip for now
          </Text>
        </PressScale>
        <View style={styles.footSpacer} />
        <PressScale
          accessibilityRole="button"
          accessibilityLabel={isLast ? 'get started' : 'next'}
          onPress={goNext}
          disabled={!valid[step]}
          style={[
            styles.nextBtn,
            { backgroundColor: valid[step] ? t.accent : t.line },
          ]}
        >
          <Text
            style={[
              styles.nextText,
              { color: valid[step] ? t.bg : t.inkFaint },
            ]}
          >
            {isLast ? 'Get started' : 'Next'}
          </Text>
          <Icon
            name="arrow-right"
            size={16}
            color={valid[step] ? t.bg : t.inkFaint}
          />
        </PressScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  progress: { flexDirection: 'row', gap: 6, marginBottom: 20 },
  seg: { flex: 1, height: 3, borderRadius: 2 },
  header: { gap: 10, marginBottom: 18 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  dot: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  dotActive: { minWidth: 34 },
  dotNum: { fontFamily: fonts.semibold, fontSize: 12 },
  title: {
    fontFamily: fonts.semibold,
    fontSize: 27,
    letterSpacing: -0.6,
    marginTop: 6,
  },
  panel: { flex: 1 },
  scrollBody: { paddingBottom: 16, paddingTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  chipText: { fontFamily: fonts.medium, fontSize: 14 },
  moreLangs: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderStyle: 'dashed',
  },
  moodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  moodCard: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
  },
  swatch: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moodBody: { flex: 1 },
  moodLabel: { fontFamily: fonts.semibold, fontSize: 15 },
  moodSub: { fontFamily: fonts.regular, fontSize: 11.5, marginTop: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tileArt: { borderRadius: 12, overflow: 'hidden' },
  tileScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  tileName: {
    position: 'absolute',
    left: 7,
    right: 7,
    bottom: 6,
    color: '#fff',
    fontFamily: fonts.semibold,
    fontSize: 11.5,
  },
  tileRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 12,
    borderWidth: 2.5,
  },
  tileCheck: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { paddingVertical: 40, alignItems: 'center', gap: 12, width: '100%' },
  emptyLine: { fontFamily: fonts.regular, fontSize: 14 },
  retry: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  loadMore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 12,
    marginTop: 14,
  },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 12,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footHidden: { opacity: 0 },
  footSpacer: { flex: 1 },
  skipBtn: { paddingHorizontal: 8, paddingVertical: 8 },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    paddingLeft: 20,
    paddingRight: 16,
    paddingVertical: 12,
  },
  nextText: { fontFamily: fonts.semibold, fontSize: 15 },
});
