import React, { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenFade } from '../components/ui/ScreenFade';
import { PressScale } from '../components/ui/PressScale';
import { ConfirmPopup } from '../components/ui/ConfirmPopup';
import { PickerPopup } from '../components/ui/PickerPopup';
import { EqFader } from '../components/ui/EqFader';
import { Icon } from '../components/Icon';
import { DOCK_CLEARANCE } from '../components/nav/Dock';
import { useTheme } from '../theme/ThemeContext';
import { fonts, label } from '../theme/tokens';
import { storage } from '../storage/mmkv';
import {
  OUTPUTS,
  PRESETS,
  applyPreset,
  getEqualizer,
  matchingPreset,
  pinOutput,
  setBand,
  setBassBoost,
  setEnabled,
  subscribeEqualizer,
} from '../lib/equalizer';

// The equalizer, as its own screen (sheets are menus; a control surface gets a
// screen). Everything here is built from what the DEVICE reported — the fader
// count, their frequencies and the dB range all come from describe(), so this
// screen is correct on a 5-band phone and a 10-band one alike.
//
// Off by default, and turning it on always asks first: the user's requirement
// was a POPUP (not a sheet) warning that audio quality can be affected, and
// that switching it on stays entirely their choice.

const WARN_KEY = 'aura.eqWarnOff'; // "don't ask again" for the warn popup

const OUT_LABEL = { speaker: 'speaker', wired: 'earphones', bluetooth: 'bluetooth' };

function hzLabel(hz) {
  return hz >= 1000 ? `${Math.round(hz / 100) / 10}k` : `${hz}`;
}

export default function EqualizerScreen({ navigation }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const [eq, setEq] = useState(getEqualizer);
  useEffect(() => subscribeEqualizer(setEq), []);
  const [ask, setAsk] = useState(false);
  const [dontAsk, setDontAsk] = useState(false);

  const activePreset = matchingPreset();
  const on = eq.enabled;

  const toggle = () => {
    if (on) {
      setEnabled(false);
      return;
    }
    if (storage.getItem(WARN_KEY) === '1') {
      setEnabled(true);
      return;
    }
    setDontAsk(false);
    setAsk(true);
  };

  const confirmOn = () => {
    if (dontAsk) {
      storage.setItem(WARN_KEY, '1');
    }
    setAsk(false);
    setEnabled(true);
  };

  // Which profile is being edited. "automatic" follows the live route (the
  // point of per-output profiles); the three explicit choices pin one, because
  // routing on OEM ROMs isn't perfectly reportable and there has to be a lever
  // when the phone gets it wrong.
  const [pickOutput, setPickOutput] = useState(false);
  const outputOptions = [
    {
      id: null,
      label: 'automatic',
      caption: `follows what you're listening on — ${
        OUT_LABEL[eq.detectedOutput] ?? eq.detectedOutput
      } right now`,
    },
    ...OUTPUTS.map(id => ({
      id,
      label: OUT_LABEL[id] ?? id,
      caption: id === eq.detectedOutput ? 'in use now' : undefined,
    })),
  ];

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <ScreenFade>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 12 },
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
          <Text style={[label(10), { color: t.inkFaint }]}>audio · equalizer</Text>
          <Text style={[styles.hero, { color: t.ink }]}>equalizer</Text>

          {!eq.available ? (
            <Text style={[styles.note, { color: t.inkSoft }]}>
              this phone doesn't offer an equalizer
              {eq.unavailableReason ? ` — ${eq.unavailableReason}` : '.'}
            </Text>
          ) : (
            <>
              {/* on/off — the house dot-row */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="equalizer"
                accessibilityState={on ? { selected: true } : {}}
                onPress={toggle}
                style={styles.row}
              >
                <View style={styles.rowMeta}>
                  <Text
                    style={[styles.rowTitle, { color: on ? t.accent : t.ink }]}
                  >
                    equalizer
                  </Text>
                  <Text style={[styles.rowCaption, { color: t.inkSoft }]}>
                    {on
                      ? 'shaping your sound.'
                      : 'off — your music plays as-is.'}
                  </Text>
                </View>
                <View
                  style={[
                    styles.dot,
                    { borderColor: on ? t.accent : t.line },
                    on && { backgroundColor: t.accent },
                  ]}
                />
              </Pressable>

              {/* faders — one per band the device actually has */}
              <View style={styles.faders}>
                {eq.bands.map((b, i) => (
                  <EqFader
                    key={b.centerHz}
                    label={hzLabel(b.centerHz)}
                    value={eq.gains[i] ?? 0}
                    min={b.minMb}
                    max={b.maxMb}
                    disabled={!on}
                    onChange={mb => setBand(i, mb)}
                  />
                ))}
              </View>
              <Text style={[styles.hint, { color: t.inkFaint }]}>
                drag a fader to shape it · hold one to reset it
              </Text>

              <Text style={[label(9.5), styles.head, { color: t.inkFaint }]}>
                presets
              </Text>
              <View style={styles.chips}>
                {PRESETS.map(p => {
                  const active = activePreset === p.id;
                  return (
                    <PressScale
                      key={p.id}
                      accessibilityRole="button"
                      accessibilityLabel={`preset ${p.name}`}
                      onPress={() => {
                        Vibration.vibrate(8);
                        applyPreset(p.id);
                      }}
                      disabled={!on}
                    >
                      <View
                        style={[
                          styles.chip,
                          { borderColor: active ? t.accent : t.line },
                          active && { backgroundColor: t.accentCard },
                          !on && styles.dim,
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            { color: active ? t.accent : t.inkSoft },
                          ]}
                        >
                          {p.name}
                        </Text>
                      </View>
                    </PressScale>
                  );
                })}
              </View>

              <Text style={[label(9.5), styles.head, { color: t.inkFaint }]}>
                bass boost
              </Text>
              <View style={styles.bassRow}>
                {[0, 250, 500, 750, 1000].map(v => {
                  const active = eq.bassBoost === v;
                  return (
                    <PressScale
                      key={v}
                      accessibilityRole="button"
                      accessibilityLabel={`bass boost ${v / 10} percent`}
                      onPress={() => {
                        Vibration.vibrate(8);
                        setBassBoost(v);
                      }}
                      disabled={!on}
                    >
                      <View
                        style={[
                          styles.chip,
                          { borderColor: active ? t.accent : t.line },
                          active && { backgroundColor: t.accentCard },
                          !on && styles.dim,
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            { color: active ? t.accent : t.inkSoft },
                          ]}
                        >
                          {v === 0 ? 'off' : `${v / 10}%`}
                        </Text>
                      </View>
                    </PressScale>
                  );
                })}
              </View>

              {/* per-output profile */}
              <Text style={[label(9.5), styles.head, { color: t.inkFaint }]}>
                profile
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="which output this profile applies to"
                onPress={() => setPickOutput(true)}
                style={styles.row}
              >
                <View style={styles.rowMeta}>
                  <Text style={[styles.rowTitle, { color: t.ink }]}>
                    applies to: {OUT_LABEL[eq.output] ?? eq.output}
                    {eq.pinned ? ' (pinned)' : ''}
                  </Text>
                  <Text style={[styles.rowCaption, { color: t.inkSoft }]}>
                    speaker, earphones and bluetooth each remember their own
                    settings. tap to choose.
                  </Text>
                </View>
                <Icon name="chevron-right" size={18} color={t.inkFaint} />
              </Pressable>
            </>
          )}
        </ScrollView>
      </ScreenFade>

      <PickerPopup
        visible={pickOutput}
        title="tune for"
        options={outputOptions}
        selected={eq.pinned ? eq.output : null}
        onSelect={pinOutput}
        onClose={() => setPickOutput(false)}
      />

      <ConfirmPopup
        visible={ask}
        title="turn on the equalizer?"
        body="it changes how your music sounds, and can reduce quality on some tracks. you can turn it off anytime."
        action="turn on"
        onConfirm={confirmOn}
        onCancel={() => setAsk(false)}
        dontAsk={dontAsk}
        onToggleDontAsk={() => setDontAsk(v => !v)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    paddingHorizontal: 22,
    paddingBottom: 24 + DOCK_CLEARANCE,
  },
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
    marginTop: 4,
    marginBottom: 6,
  },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, marginTop: 14 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  rowMeta: { flex: 1, paddingRight: 12, gap: 2 },
  rowTitle: { fontFamily: fonts.medium, fontSize: 15 },
  rowCaption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2 },
  faders: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 11.5,
    textAlign: 'center',
    marginTop: 10,
  },
  head: { marginTop: 22, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bassRow: { flexDirection: 'row', gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipText: { fontFamily: fonts.medium, fontSize: 13 },
  dim: { opacity: 0.45 },
});
