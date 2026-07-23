import React, { useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { ScreenFade } from '../components/ui/ScreenFade';
import { PressScale } from '../components/ui/PressScale';
import { Icon } from '../components/Icon';
import { DOCK_CLEARANCE } from '../components/nav/Dock';
import { useTheme } from '../theme/ThemeContext';
import { fonts, label } from '../theme/tokens';
import { adminPushReach, adminPushSend } from '../lib/push';
import { API_BASE } from '../lib/auth';
import { showToast } from '../lib/toast';

// The admin composer as its own SCREEN (user-directed after two failed sheet
// rounds: with the keyboard up a sheet has a quarter of the display, and a
// pinned preview eats it — the message field ended up unreachable twice).
// Standing rule from that: sheets are for menus and pick-lists; anything with
// text entry gets a full screen.
//
// Layout is the Talk column: fixed top (back / hero / the pinned live
// preview), a flexing ScrollView of fields, and a docked send bar —
// adjustResize slides the bar above the keyboard and the ScrollView keeps
// the focused field visible, exactly like Talk's compose row.

// The aura mark as atmosphere: the launcher icon's own ring geometry
// (core/inner/outer ≈ 7.7 : 18.3 : 29.9) scaled large and anchored to the
// top-right corner, ~two-thirds bled off-canvas behind the preview.
const RING_SCALE = 9;

function AuraMarkBackdrop({ width, top }) {
  const { t } = useTheme();
  const cx = width - 40;
  const cy = top + 60;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Circle cx={cx} cy={cy} r={7.73 * RING_SCALE} fill={t.accent} opacity={0.1} />
        <Circle
          cx={cx}
          cy={cy}
          r={18.31 * RING_SCALE}
          stroke={t.accent}
          strokeWidth={2}
          fill="none"
          opacity={0.08}
        />
        <Circle
          cx={cx}
          cy={cy}
          r={29.92 * RING_SCALE}
          stroke={t.ink}
          strokeWidth={2}
          fill="none"
          opacity={0.05}
        />
      </Svg>
    </View>
  );
}

export default function AdminComposeScreen({ navigation }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [reach, setReach] = useState(null);
  useEffect(() => {
    let live = true;
    adminPushReach()
      .then(r => {
        if (live) {
          setReach(r);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const [form, setForm] = useState({
    title: '',
    body: '',
    image: '',
    link: '',
    email: '',
    toAll: false,
  });
  const [busy, setBusy] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);
  const canSend = !busy && !!form.title.trim() && !!form.body.trim();
  const set = (key, v) => setForm(f => ({ ...f, [key]: v }));

  // Every aura push wears the composed card (server /api/push/card-art):
  // no image → the brand-only card; catalog art → composited with the scrim,
  // seeded ribbon wave and wordmark; any other https url can't be composited
  // (the public endpoint only fetches aura-hosted art) and rides raw. The
  // preview loads the EXACT url the push will carry — true WYSIWYG.
  const raw = form.image.trim();
  const cardImage = !raw
    ? `${API_BASE}/api/push/card-art`
    : /^https:\/\/c\.saavncdn\.com\//.test(raw)
    ? `${API_BASE}/api/push/card-art?art=${encodeURIComponent(raw)}`
    : raw.startsWith('https://')
    ? raw
    : null;
  const previewImage = cardImage && !imageBroken ? cardImage : null;

  const send = async () => {
    if (!canSend) {
      return;
    }
    setBusy(true);
    try {
      const audience = form.email.trim() || (form.toAll ? 'all' : 'me');
      const out = await adminPushSend({
        title: form.title,
        body: form.body,
        image: cardImage ?? undefined,
        link: form.link.trim() || undefined,
        audience,
      });
      showToast(`sent to ${out.sent} device${out.sent === 1 ? '' : 's'}.`, {
        tick: true,
      });
      navigation.goBack();
    } catch (err) {
      showToast(`couldn't send — ${err.message}`);
      setBusy(false);
    }
  };

  const audienceLine = form.email.trim()
    ? `goes to ${form.email.trim()} only.`
    : form.toAll
    ? reach
      ? `goes to every enrolled device — ${reach.devices} device${reach.devices === 1 ? '' : 's'} across ${reach.users} user${reach.users === 1 ? '' : 's'}.`
      : 'goes to every enrolled device.'
    : 'goes only to your own devices (a safe test).';

  const everyoneOn = form.toAll && !form.email.trim();

  const inputStyle = [
    styles.input,
    { color: t.ink, borderColor: t.line, backgroundColor: t.bg },
  ];

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <AuraMarkBackdrop width={width} top={insets.top} />
      <ScreenFade>
        <View style={[styles.column, { paddingTop: insets.top + 12 }]}>
          {/* ── fixed top: chrome + the pinned live preview ── */}
          <View style={styles.head}>
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
              admin · push
            </Text>
            <Text style={[styles.hero, { color: t.ink }]}>
              send a notification
            </Text>

            <Text style={[label(9.5), styles.sectionHead, { color: t.inkFaint }]}>
              preview
            </Text>
            <View
              style={[
                styles.previewCard,
                { backgroundColor: t.surface, borderColor: t.line },
              ]}
            >
              <View style={styles.previewTop}>
                <View
                  style={[styles.previewDot, { backgroundColor: t.accent }]}
                />
                <Text style={[styles.previewApp, { color: t.inkSoft }]}>
                  aura
                </Text>
                <Text style={[styles.previewApp, { color: t.inkFaint }]}>
                  {' '}
                  · now
                </Text>
              </View>
              <Text
                numberOfLines={1}
                style={[styles.previewTitle, { color: t.ink }]}
              >
                {form.title.trim() || 'hello from aura'}
              </Text>
              <Text
                numberOfLines={2}
                style={[styles.previewBody, { color: t.inkSoft }]}
              >
                {form.body.trim() ||
                  'your message shows here, exactly how it lands.'}
              </Text>
              {previewImage && (
                <Image
                  source={{ uri: previewImage }}
                  onError={() => setImageBroken(true)}
                  resizeMode="cover"
                  accessibilityLabel="notification image preview"
                  style={styles.previewBanner}
                />
              )}
              {imageBroken && !!form.image.trim() && (
                <Text style={[styles.previewHint, { color: t.inkFaint }]}>
                  couldn't load that image
                </Text>
              )}
            </View>
          </View>

          {/* ── scrolling middle: the fields ── */}
          <ScrollView
            style={styles.fill}
            contentContainerStyle={styles.fields}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={[label(9.5), styles.sectionHead, { color: t.inkFaint }]}>
              the card
            </Text>
            <TextInput
              value={form.title}
              onChangeText={v => set('title', v)}
              placeholder="title"
              placeholderTextColor={t.inkFaint}
              cursorColor={t.accent}
              selectionColor={t.accent}
              maxLength={120}
              accessibilityLabel="notification title"
              style={inputStyle}
            />
            <TextInput
              value={form.body}
              onChangeText={v => set('body', v)}
              placeholder="message"
              placeholderTextColor={t.inkFaint}
              cursorColor={t.accent}
              selectionColor={t.accent}
              maxLength={300}
              multiline
              accessibilityLabel="notification message"
              style={[inputStyle, styles.inputTall]}
            />
            <TextInput
              value={form.image}
              onChangeText={v => {
                setImageBroken(false);
                set('image', v);
              }}
              placeholder="image url (optional — empty = the aura card)"
              placeholderTextColor={t.inkFaint}
              cursorColor={t.accent}
              selectionColor={t.accent}
              autoCapitalize="none"
              keyboardType="url"
              accessibilityLabel="notification image url"
              style={inputStyle}
            />
            <TextInput
              value={form.link}
              onChangeText={v => set('link', v)}
              placeholder="link (optional — opens on tap)"
              placeholderTextColor={t.inkFaint}
              cursorColor={t.accent}
              selectionColor={t.accent}
              autoCapitalize="none"
              keyboardType="url"
              accessibilityLabel="notification link"
              style={inputStyle}
            />

            <Text style={[label(9.5), styles.sectionHead, { color: t.inkFaint }]}>
              who gets it
            </Text>
            <TextInput
              value={form.email}
              onChangeText={v => set('email', v)}
              placeholder="one email (optional)"
              placeholderTextColor={t.inkFaint}
              cursorColor={t.accent}
              selectionColor={t.accent}
              autoCapitalize="none"
              keyboardType="email-address"
              accessibilityLabel="send to one email"
              style={inputStyle}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="send to everyone"
              accessibilityState={everyoneOn ? { selected: true } : {}}
              disabled={!!form.email.trim()}
              onPress={() => set('toAll', !form.toAll)}
              style={styles.row}
            >
              <View style={styles.rowMeta}>
                <Text
                  style={[
                    styles.rowTitle,
                    { color: everyoneOn ? t.accent : t.ink },
                  ]}
                >
                  send to everyone
                </Text>
                <Text style={[styles.rowCaption, { color: t.inkSoft }]}>
                  {form.email.trim()
                    ? 'ignored — the email above wins.'
                    : reach
                    ? `reaches ${reach.devices} device${reach.devices === 1 ? '' : 's'} across ${reach.users} user${reach.users === 1 ? '' : 's'}.`
                    : 'checking reach…'}
                </Text>
              </View>
              <View
                style={[
                  styles.dot,
                  { borderColor: everyoneOn ? t.accent : t.line },
                  everyoneOn && { backgroundColor: t.accent },
                ]}
              />
            </Pressable>
            {!!reach && !reach.configured && (
              <Text style={[styles.rowCaption, { color: t.inkSoft }]}>
                sender not configured — add the firebase key to the server env
                first.
              </Text>
            )}
          </ScrollView>

          {/* ── docked send bar — rides above the keyboard (adjustResize) ── */}
          <View
            style={[
              styles.sendBar,
              { backgroundColor: t.bg, borderTopColor: t.line },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="send notification"
              disabled={!canSend}
              onPress={send}
              style={[
                styles.send,
                { borderColor: t.accent },
                !canSend && styles.dim,
              ]}
            >
              <Text style={[label(9.5), { color: t.accent }]}>
                {busy ? 'sending…' : 'send notification'}
              </Text>
            </Pressable>
            <Text style={[styles.rowCaption, styles.sendHint, { color: t.inkSoft }]}>
              {audienceLine}
            </Text>
          </View>
        </View>
      </ScreenFade>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  column: { flex: 1 },
  fill: { flex: 1 },
  head: { paddingHorizontal: 22 },
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
  },
  sectionHead: { marginTop: 14, marginBottom: 6 },
  previewCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 3,
  },
  previewTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  previewDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  previewApp: { fontFamily: fonts.medium, fontSize: 11.5 },
  previewTitle: { fontFamily: fonts.semibold, fontSize: 14.5 },
  previewBody: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  previewBanner: {
    height: 132,
    borderRadius: 10,
    marginTop: 8,
    alignSelf: 'stretch',
  },
  previewHint: { fontFamily: fonts.regular, fontSize: 11.5, marginTop: 6 },
  fields: { paddingHorizontal: 22, paddingBottom: 16 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontFamily: fonts.regular,
    fontSize: 14.5,
    marginTop: 8,
  },
  inputTall: { minHeight: 64, textAlignVertical: 'top' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  rowMeta: { flex: 1, paddingRight: 12, gap: 2 },
  rowTitle: { fontFamily: fonts.medium, fontSize: 15 },
  rowCaption: { fontFamily: fonts.regular, fontSize: 12 },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2 },
  sendBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: DOCK_CLEARANCE + 8,
    gap: 6,
  },
  send: {
    borderWidth: 1,
    borderRadius: 999,
    alignItems: 'center',
    paddingVertical: 11,
  },
  dim: { opacity: 0.55 },
  sendHint: { textAlign: 'center' },
});
