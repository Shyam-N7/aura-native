import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from 'react-native';
import { PressScale } from '../ui/PressScale';
import { ConfirmPopup } from '../ui/ConfirmPopup';
import { PickerPopup } from '../ui/PickerPopup';
import { EqFader } from '../ui/EqFader';
import { Icon } from '../Icon';
import { useTheme } from '../../theme/ThemeContext';
import { fonts, label, radii, type } from '../../theme/tokens';
import { storage } from '../../storage/mmkv';
import {
  OUTPUTS,
  PRESETS,
  applyGains,
  applyPreset,
  getEqualizer,
  matchingPreset,
  pinOutput,
  setBand,
  setBassBoost,
  setBoost,
  setEnabled,
  subscribeEqualizer,
} from '../../lib/equalizer';
import {
  MAX_NAME,
  MAX_PRESETS,
  deleteEqUserPreset,
  getEqUserPresets,
  saveEqUserPreset,
  subscribeEqUserPresets,
} from '../../lib/eqPresets';

// The equalizer's whole control surface, container-agnostic: the settings
// SCREEN wraps it with a header, and the player opens it as a POPUP over the
// music so a tweak mid-song never navigates away.
//
// Nothing here scrolls. The faders are the page; presets, bass boost and the
// output profile are one button each, opening a popup — so every option is a
// single tap away and a swipe anywhere is always a fader drag, never a fight
// with a scroller.

const WARN_KEY = 'aura.eqWarnOff'; // "don't ask again" for the warn popup
const OUT_LABEL = { speaker: 'speaker', wired: 'earphones', bluetooth: 'bluetooth' };

const BASS_LEVELS = [0, 250, 500, 750, 1000].map(v => ({
  id: v,
  label: v === 0 ? 'off' : `${v / 10}%`,
}));

// Volume boost stops (millibels). Above +6 dB a warning stands between the
// tap and the ears (docs/perf/04 4b); the plain (LoudnessEnhancer) fallback
// never offers those stops at all. Labeled as louder-by percent (amplitude,
// 10^(dB/20)−1) with the dB alongside — "+100% · +6 dB" reads as "twice as
// loud a signal" without asking anyone to know decibels.
const boostPct = mb => Math.round((10 ** (mb / 100 / 20) - 1) * 100);
const boostText = mb => `+${boostPct(mb)}% · +${mb / 100} dB`;
const BOOST_LEVELS = [0, 300, 600, 900, 1200].map(v => ({
  id: v,
  label: v === 0 ? 'Off' : boostText(v),
  caption: v > 600 ? 'Strong — watch your ears' : undefined,
}));

function hzLabel(hz) {
  return hz >= 1000 ? `${Math.round(hz / 100) / 10}k` : `${hz}`;
}

export function EqualizerPanel() {
  const { t } = useTheme();
  const [eq, setEq] = useState(getEqualizer);
  useEffect(() => subscribeEqualizer(setEq), []);

  const [mine, setMine] = useState(() => getEqUserPresets());
  useEffect(
    () => subscribeEqUserPresets(() => setMine(getEqUserPresets())),
    [],
  );
  // Only the saved curves that fit this device's band count can be applied.
  const usable = mine.filter(p => p.gains.length === eq.bands.length);

  const [ask, setAsk] = useState(false);
  // A >+6dB boost pick waits here until the warning is answered.
  const [warnBoost, setWarnBoost] = useState(null);
  const [dontAsk, setDontAsk] = useState(false);
  // Which picker is open — 'presets' | 'bass' | 'output' | null. One value,
  // so two popups can never fight over the screen.
  const [open, setOpen] = useState(null);
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState('');
  // Save problems surface INLINE: a toast would render behind the open Modal.
  const [saveError, setSaveError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const on = eq.enabled;
  const activePreset = matchingPreset();
  // A saved curve is "active" when the live gains match it exactly.
  const activeMine = usable.find(
    p => on && p.gains.every((mb, i) => mb === eq.gains[i]),
  );

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

  // Every fader can be re-zeroed by holding it — a gesture that doesn't exist
  // with a screen reader on, and that nothing in the chrome offered as a
  // button. This is that reset as a visible control. It flattens ALL bands
  // rather than one: the panel has no notion of a "current" band to act on,
  // and flat is exactly what the per-fader hold means, band by band.
  const resetBands = () => {
    Vibration.vibrate(8);
    applyGains(eq.bands.map(() => 0));
  };

  const closePresets = () => {
    setOpen(null);
    setNaming(false);
    setNewName('');
    setSaveError(null);
  };

  const saveCurrent = () => {
    const name = newName.trim();
    if (!name) {
      return;
    }
    if (usable.length >= MAX_PRESETS) {
      setSaveError(`that's the limit — ${MAX_PRESETS} saved settings.`);
      return;
    }
    if (mine.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      setSaveError('You already have one by that name.');
      return;
    }
    if (!saveEqUserPreset(name, eq.gains)) {
      setSaveError("Couldn't save that one.");
      return;
    }
    // Feedback is the chip appearing right above, plus a tick.
    Vibration.vibrate(8);
    setNewName('');
    setNaming(false);
    setSaveError(null);
  };

  const outputOptions = [
    {
      id: null,
      label: 'Automatic',
      caption: `follows what you're listening on — ${
        OUT_LABEL[eq.detectedOutput] ?? eq.detectedOutput
      } right now`,
    },
    ...OUTPUTS.map(id => ({
      id,
      label: OUT_LABEL[id] ?? id,
      caption:
        id === eq.detectedOutput
          ? 'In use now'
          : 'Keeps its own settings',
    })),
  ];

  if (!eq.available) {
    // Two different situations, and one sentence used to cover both: a phone
    // that has no equalizer, and a phone that has one an OEM sound app is
    // currently holding. Saying "this phone doesn't offer an equalizer —
    // another app is controlling the sound" contradicts itself in the same
    // breath, so the permanent verdict is only used when it IS permanent.
    return (
      <Text style={[styles.note, { color: t.inkSoft }]}>
        {eq.deviceEq
          ? eq.unavailableReason ?? 'The equalizer isn’t available right now.'
          : `this phone doesn't offer an equalizer${
              eq.unavailableReason ? ` — ${eq.unavailableReason}` : '.'
            }`}
      </Text>
    );
  }

  const chip = (key, text, active, onPress, onLongPress) => (
    <PressScale
      key={key}
      accessibilityRole="button"
      accessibilityLabel={text}
      onPress={onPress}
      onLongPress={onLongPress}
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
        <Text style={[styles.chipText, { color: active ? t.accent : t.inkSoft }]}>
          {text}
        </Text>
      </View>
    </PressScale>
  );

  // The three options as full-width buttons: name on the left, the current
  // value on the right, a tap opens the matching popup.
  const pickBtn = (key, title, value, popup) => (
    <PressScale
      key={key}
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${value}`}
      onPress={() => setOpen(popup)}
      disabled={!on}
    >
      <View style={[styles.btn, { borderColor: t.line }, !on && styles.dim]}>
        <Text style={[styles.btnTitle, { color: t.inkSoft }]}>{title}</Text>
        <View style={styles.btnValue}>
          <Text
            numberOfLines={1}
            style={[styles.btnValueText, { color: t.ink }]}
          >
            {value}
          </Text>
          <Icon name="chevron-right" size={16} color={t.inkFaint} />
        </View>
      </View>
    </PressScale>
  );

  const presetName =
    activeMine?.name ??
    PRESETS.find(p => p.id === activePreset)?.name ??
    'custom';
  const bassLabel = eq.bassBoost === 0 ? 'off' : `${eq.bassBoost / 10}%`;
  const boostLabel = eq.boostMb === 0 ? 'off' : boostText(eq.boostMb);
  const outputLabel =
    (OUT_LABEL[eq.output] ?? eq.output) + (eq.pinned ? ' · pinned' : '');

  return (
    <View>
      {/* on/off — the house dot-row */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="equalizer"
        accessibilityState={on ? { selected: true } : {}}
        onPress={toggle}
        style={styles.row}
      >
        <View style={styles.rowMeta}>
          <Text style={[styles.rowTitle, { color: on ? t.accent : t.ink }]}>
            Equalizer
          </Text>
          <Text style={[styles.rowCaption, { color: t.inkSoft }]}>
            {on ? 'Shaping your sound.' : 'Off — your music plays as-is.'}
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
      {/* The chip the popups already use, so nothing new is invented; the
          slop takes its ~33dp box past the 48dp touch target. */}
      <View style={styles.resetRow}>
        <PressScale
          accessibilityRole="button"
          accessibilityLabel="reset the bands"
          accessibilityState={on ? {} : { disabled: true }}
          onPress={resetBands}
          disabled={!on}
          hitSlop={10}
        >
          <View
            style={[styles.chip, { borderColor: t.line }, !on && styles.dim]}
          >
            <Text style={[styles.chipText, { color: t.inkSoft }]}>Reset</Text>
          </View>
        </PressScale>
      </View>

      <View style={styles.btns}>
        {pickBtn('presets', 'Presets', presetName, 'presets')}
        {pickBtn('bass', 'Bass boost', bassLabel, 'bass')}
        {eq.boostMode !== 'none' &&
          pickBtn('boost', 'Volume boost', boostLabel, 'boost')}
        {pickBtn('output', 'Applies to', outputLabel, 'output')}
      </View>

      {/* presets: the mood presets and the user's own saved curves. Applying
          one keeps the popup open so different presets can be compared by ear
          without reopening; the scrim (or back) closes it. */}
      <Modal
        transparent
        statusBarTranslucent
        visible={open === 'presets'}
        animationType="fade"
        onRequestClose={closePresets}
      >
        {/* While naming, the card rides near the top: a translucent-status-bar
            Modal never resizes for the keyboard on Android, so a centered card
            would put the input right under it. */}
        <Pressable
          style={[styles.popScrim, naming && styles.popScrimTop]}
          onPress={closePresets}
          accessibilityLabel="dismiss"
        >
          <Pressable
            style={[
              styles.popCard,
              { backgroundColor: t.surface, borderColor: t.line },
            ]}
            // Swallow taps on the card so only the scrim closes. Everything in
            // here is TAPPED (chips are RN Pressables, which work fine inside
            // a parent Pressable) — no drags, so nothing gets swallowed.
            onPress={() => {}}
          >
            <Text style={[label(9.5), styles.popLabel, { color: t.inkFaint }]}>
              Presets
            </Text>
            <View style={styles.chips}>
              {PRESETS.map(p =>
                chip(p.id, p.name, activePreset === p.id && !activeMine, () => {
                  Vibration.vibrate(8);
                  applyPreset(p.id);
                }),
              )}
            </View>

            <Text style={[label(9.5), styles.popHead, { color: t.inkFaint }]}>
              Your settings
            </Text>
            {usable.length > 0 && (
              <View style={styles.chips}>
                {usable.map(p =>
                  chip(
                    p.id,
                    p.name,
                    activeMine?.id === p.id,
                    () => {
                      Vibration.vibrate(8);
                      applyGains(p.gains);
                    },
                    () => setConfirmDelete(p),
                  ),
                )}
              </View>
            )}
            {naming ? (
              <View style={styles.save}>
                <TextInput
                  autoFocus
                  value={newName}
                  onChangeText={text => {
                    setNewName(text);
                    if (saveError) {
                      setSaveError(null);
                    }
                  }}
                  onSubmitEditing={saveCurrent}
                  placeholder="Name these settings"
                  placeholderTextColor={t.inkFaint}
                  cursorColor={t.accent}
                  selectionColor={t.accent}
                  maxLength={MAX_NAME}
                  accessibilityLabel="name these settings"
                  style={[
                    styles.input,
                    { color: t.ink, borderColor: t.line, backgroundColor: t.bg },
                  ]}
                />
                {!!saveError && (
                  <Text style={[styles.error, { color: t.accent }]}>
                    {saveError}
                  </Text>
                )}
                <View style={styles.saveActions}>
                  <PressScale
                    accessibilityRole="button"
                    accessibilityLabel="cancel"
                    onPress={() => {
                      setNaming(false);
                      setNewName('');
                      setSaveError(null);
                    }}
                    hitSlop={8}
                  >
                    <Text style={[styles.saveBtn, { color: t.inkSoft }]}>
                      Cancel
                    </Text>
                  </PressScale>
                  <PressScale
                    accessibilityRole="button"
                    accessibilityLabel="save these settings"
                    onPress={saveCurrent}
                    hitSlop={8}
                  >
                    <Text style={[styles.saveBtn, { color: t.accent }]}>Save</Text>
                  </PressScale>
                </View>
              </View>
            ) : (
              <PressScale
                accessibilityRole="button"
                accessibilityLabel="save these settings"
                onPress={() => setNaming(true)}
              >
                <View style={[styles.addRow, { borderColor: t.line }]}>
                  <Icon name="plus" size={15} color={t.inkSoft} />
                  <Text style={[styles.chipText, { color: t.inkSoft }]}>
                    {usable.length
                      ? 'Save these settings'
                      : 'Save these settings to reuse later'}
                  </Text>
                </View>
              </PressScale>
            )}
            {usable.length > 0 && (
              <Text style={[styles.hint, styles.hintLeft, { color: t.inkFaint }]}>
                Hold one of yours to delete it
              </Text>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <PickerPopup
        visible={open === 'bass'}
        title="Bass boost"
        options={BASS_LEVELS}
        selected={eq.bassBoost}
        onSelect={v => {
          Vibration.vibrate(8);
          setBassBoost(v);
        }}
        onClose={() => setOpen(null)}
      />

      {/* volume boost: gain into a limiter, never bare gain. The plain
          (LoudnessEnhancer) fallback only ever sees the ≤+6 dB stops. */}
      <PickerPopup
        visible={open === 'boost'}
        title="Volume boost"
        options={
          eq.boostMode === 'plain'
            ? BOOST_LEVELS.filter(o => o.id <= 600)
            : BOOST_LEVELS
        }
        selected={eq.boostMb}
        onSelect={v => {
          Vibration.vibrate(8);
          if (v > 600 && v > eq.boostMb) {
            setWarnBoost(v);
            return;
          }
          setBoost(v);
        }}
        onClose={() => setOpen(null)}
      />

      <ConfirmPopup
        visible={warnBoost != null}
        title="Boost this much?"
        body="Above +6 dB some songs can sound strained, and it gets loud fast in earphones. Take care of your ears."
        action="Boost it"
        onConfirm={() => {
          setBoost(warnBoost);
          setWarnBoost(null);
        }}
        onCancel={() => setWarnBoost(null)}
      />

      <PickerPopup
        visible={open === 'output'}
        title="Tune for"
        options={outputOptions}
        selected={eq.pinned ? eq.output : null}
        onSelect={pinOutput}
        onClose={() => setOpen(null)}
      />

      <ConfirmPopup
        visible={ask}
        title="Turn on the equalizer?"
        body="It changes how your music sounds, and can reduce quality on some tracks. You can turn it off anytime."
        action="Turn on"
        onConfirm={confirmOn}
        onCancel={() => setAsk(false)}
        dontAsk={dontAsk}
        onToggleDontAsk={() => setDontAsk(v => !v)}
      />

      <ConfirmPopup
        visible={!!confirmDelete}
        title={`Delete "${confirmDelete?.name ?? ''}"?`}
        body="The saved settings go, your current sound stays as it is."
        action="Delete"
        danger
        onConfirm={() => {
          deleteEqUserPreset(confirmDelete.id);
          Vibration.vibrate(8);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, marginTop: 14 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  rowMeta: { flex: 1, paddingRight: 12, gap: 2 },
  rowTitle: type.rowTitle,
  rowCaption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2 },
  faders: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 11.5,
    textAlign: 'center',
    marginTop: 10,
  },
  hintLeft: { textAlign: 'left', marginTop: 8 },
  resetRow: { alignItems: 'center', marginTop: 10 },
  btns: { marginTop: 14, gap: 8 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  btnTitle: { fontFamily: fonts.medium, fontSize: 13.5 },
  btnValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  btnValueText: { fontFamily: fonts.medium, fontSize: 13.5, flexShrink: 1 },
  popScrim: {
    flex: 1,
    backgroundColor: 'rgba(10, 8, 6, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  popScrimTop: { justifyContent: 'flex-start', paddingTop: 72 },
  popCard: {
    alignSelf: 'stretch',
    maxWidth: 400,
    borderWidth: 1,
    borderRadius: 20,
    padding: 18,
  },
  popLabel: { marginBottom: 8 },
  popHead: { marginTop: 18, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipText: { fontFamily: fonts.medium, fontSize: 13 },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: radii.pill,
    borderStyle: 'dashed',
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  save: { marginTop: 8, gap: 10 },
  input: {
    borderWidth: 1,
    borderRadius: radii.input,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontFamily: fonts.regular,
    fontSize: 14.5,
  },
  error: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 17 },
  saveActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 22 },
  saveBtn: { fontFamily: fonts.medium, fontSize: 14 },
  dim: { opacity: 0.45 },
});
