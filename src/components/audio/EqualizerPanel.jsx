import React, { useEffect, useState } from 'react';
import {
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
import { fonts, label } from '../../theme/tokens';
import { storage } from '../../storage/mmkv';
import { showToast } from '../../lib/toast';
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
// SCREEN wraps it in a scroller with a header, and the player opens it as a
// POPUP over the music so a tweak mid-song never navigates away. Everything
// here is built from what the DEVICE reported (band count, frequencies, dB
// range), so it's correct on any phone.

const WARN_KEY = 'aura.eqWarnOff'; // "don't ask again" for the warn popup
const OUT_LABEL = { speaker: 'speaker', wired: 'earphones', bluetooth: 'bluetooth' };

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
  const [dontAsk, setDontAsk] = useState(false);
  const [pickOutput, setPickOutput] = useState(false);
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState('');
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

  const saveCurrent = () => {
    const name = newName.trim();
    if (!name) {
      return;
    }
    if (usable.length >= MAX_PRESETS) {
      showToast(`that's the limit — ${MAX_PRESETS} saved settings.`);
      return;
    }
    if (mine.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      showToast('you already have one by that name.');
      return;
    }
    if (!saveEqUserPreset(name, eq.gains)) {
      showToast("couldn't save that one.");
      return;
    }
    Vibration.vibrate(8);
    showToast(`saved "${name}".`, { tick: true });
    setNewName('');
    setNaming(false);
  };

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

  if (!eq.available) {
    return (
      <Text style={[styles.note, { color: t.inkSoft }]}>
        this phone doesn't offer an equalizer
        {eq.unavailableReason ? ` — ${eq.unavailableReason}` : '.'}
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
            equalizer
          </Text>
          <Text style={[styles.rowCaption, { color: t.inkSoft }]}>
            {on ? 'shaping your sound.' : 'off — your music plays as-is.'}
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

      <Text style={[label(9.5), styles.head, { color: t.inkFaint }]}>presets</Text>
      <View style={styles.chips}>
        {PRESETS.map(p =>
          chip(p.id, p.name, activePreset === p.id && !activeMine, () => {
            Vibration.vibrate(8);
            applyPreset(p.id);
          }),
        )}
      </View>

      {/* the user's own curves */}
      <Text style={[label(9.5), styles.head, { color: t.inkFaint }]}>
        your settings
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
            onChangeText={setNewName}
            onSubmitEditing={saveCurrent}
            placeholder="name these settings"
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
          <View style={styles.saveActions}>
            <PressScale
              accessibilityRole="button"
              accessibilityLabel="cancel"
              onPress={() => {
                setNaming(false);
                setNewName('');
              }}
              hitSlop={8}
            >
              <Text style={[styles.saveBtn, { color: t.inkSoft }]}>cancel</Text>
            </PressScale>
            <PressScale
              accessibilityRole="button"
              accessibilityLabel="save these settings"
              onPress={saveCurrent}
              hitSlop={8}
            >
              <Text style={[styles.saveBtn, { color: t.accent }]}>save</Text>
            </PressScale>
          </View>
        </View>
      ) : (
        <PressScale
          accessibilityRole="button"
          accessibilityLabel="save these settings"
          onPress={() => setNaming(true)}
          disabled={!on}
        >
          <View
            style={[styles.addRow, { borderColor: t.line }, !on && styles.dim]}
          >
            <Icon name="plus" size={15} color={t.inkSoft} />
            <Text style={[styles.chipText, { color: t.inkSoft }]}>
              {usable.length
                ? 'save these settings'
                : 'save these settings to reuse later'}
            </Text>
          </View>
        </PressScale>
      )}
      {usable.length > 0 && (
        <Text style={[styles.hint, styles.hintLeft, { color: t.inkFaint }]}>
          hold one of yours to delete it
        </Text>
      )}

      <Text style={[label(9.5), styles.head, { color: t.inkFaint }]}>
        bass boost
      </Text>
      <View style={styles.chips}>
        {[0, 250, 500, 750, 1000].map(v =>
          chip(`bb${v}`, v === 0 ? 'off' : `${v / 10}%`, eq.bassBoost === v, () => {
            Vibration.vibrate(8);
            setBassBoost(v);
          }),
        )}
      </View>

      <Text style={[label(9.5), styles.head, { color: t.inkFaint }]}>profile</Text>
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
            speaker, earphones and bluetooth each remember their own settings.
            tap to choose.
          </Text>
        </View>
        <Icon name="chevron-right" size={18} color={t.inkFaint} />
      </Pressable>

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

      <ConfirmPopup
        visible={!!confirmDelete}
        title={`delete "${confirmDelete?.name ?? ''}"?`}
        body="the saved settings go, your current sound stays as it is."
        action="delete"
        onConfirm={() => {
          deleteEqUserPreset(confirmDelete.id);
          showToast('deleted.');
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
  rowTitle: { fontFamily: fonts.medium, fontSize: 15 },
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
  head: { marginTop: 22, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipText: { fontFamily: fonts.medium, fontSize: 13 },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 999,
    borderStyle: 'dashed',
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  save: { marginTop: 8, gap: 10 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontFamily: fonts.regular,
    fontSize: 14.5,
  },
  saveActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 22 },
  saveBtn: { fontFamily: fonts.medium, fontSize: 14 },
  dim: { opacity: 0.45 },
});
