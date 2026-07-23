import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Sheet } from '../components/ui/Sheet';
import { useTheme } from '../theme/ThemeContext';
import { fonts, label } from '../theme/tokens';
import { adminPushReach, adminPushSend } from '../lib/push';
import { showToast } from '../lib/toast';

// The admin composer — opened from the you-tab settings row. A live preview
// card (drawn like the Android notification it becomes) sits above the
// fields and re-renders as you type; empty fields show sample copy so the
// card never previews blank. Audience defaults to your own devices — the
// safe dry-run — until the everyone switch or an email says otherwise.
export function AdminPushSheet({ onClose }) {
  const { t } = useTheme();
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
    link: '',
    email: '',
    toAll: false,
  });
  const [busy, setBusy] = useState(false);
  const canSend = !busy && !!form.title.trim() && !!form.body.trim();

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
        link: form.link.trim() || undefined,
        audience,
      });
      showToast(`sent to ${out.sent} device${out.sent === 1 ? '' : 's'}.`, {
        tick: true,
      });
      onClose();
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

  return (
    <Sheet onClose={onClose} closeLabel="close notification composer">
      <Text style={[styles.title, { color: t.ink }]}>send a notification</Text>

      <Text style={[label(9.5), styles.head, { color: t.inkFaint }]}>
        preview
      </Text>
      <View
        style={[
          styles.previewCard,
          { backgroundColor: t.surface, borderColor: t.line },
        ]}
      >
        <View style={styles.previewTop}>
          <View style={[styles.previewDot, { backgroundColor: t.accent }]} />
          <Text style={[styles.previewApp, { color: t.inkSoft }]}>aura</Text>
          <Text style={[styles.previewApp, { color: t.inkFaint }]}> · now</Text>
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
          {form.body.trim() || 'your message shows here, exactly how it lands.'}
        </Text>
      </View>

      <TextInput
        value={form.title}
        onChangeText={v => setForm(f => ({ ...f, title: v }))}
        placeholder="title"
        placeholderTextColor={t.inkFaint}
        cursorColor={t.accent}
        selectionColor={t.accent}
        maxLength={120}
        accessibilityLabel="notification title"
        style={[
          styles.input,
          { color: t.ink, borderColor: t.line, backgroundColor: t.bg },
        ]}
      />
      <TextInput
        value={form.body}
        onChangeText={v => setForm(f => ({ ...f, body: v }))}
        placeholder="message"
        placeholderTextColor={t.inkFaint}
        cursorColor={t.accent}
        selectionColor={t.accent}
        maxLength={300}
        multiline
        accessibilityLabel="notification message"
        style={[
          styles.input,
          styles.inputTall,
          { color: t.ink, borderColor: t.line, backgroundColor: t.bg },
        ]}
      />
      <TextInput
        value={form.link}
        onChangeText={v => setForm(f => ({ ...f, link: v }))}
        placeholder="link (optional — opens on tap)"
        placeholderTextColor={t.inkFaint}
        cursorColor={t.accent}
        selectionColor={t.accent}
        autoCapitalize="none"
        keyboardType="url"
        accessibilityLabel="notification link"
        style={[
          styles.input,
          { color: t.ink, borderColor: t.line, backgroundColor: t.bg },
        ]}
      />

      <Text style={[label(9.5), styles.head, { color: t.inkFaint }]}>
        who gets it
      </Text>
      <TextInput
        value={form.email}
        onChangeText={v => setForm(f => ({ ...f, email: v }))}
        placeholder="one email (optional)"
        placeholderTextColor={t.inkFaint}
        cursorColor={t.accent}
        selectionColor={t.accent}
        autoCapitalize="none"
        keyboardType="email-address"
        accessibilityLabel="send to one email"
        style={[
          styles.input,
          { color: t.ink, borderColor: t.line, backgroundColor: t.bg },
        ]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="send to everyone"
        accessibilityState={form.toAll ? { selected: true } : {}}
        disabled={!!form.email.trim()}
        onPress={() => setForm(f => ({ ...f, toAll: !f.toAll }))}
        style={styles.row}
      >
        <View style={styles.rowMeta}>
          <Text
            style={[
              styles.rowTitle,
              { color: form.toAll && !form.email.trim() ? t.accent : t.ink },
            ]}
          >
            send to everyone
          </Text>
          <Text style={[styles.rowCaption, { color: t.inkSoft }]}>
            {audienceLine}
          </Text>
        </View>
        <View
          style={[
            styles.dot,
            {
              borderColor:
                form.toAll && !form.email.trim() ? t.accent : t.line,
            },
            form.toAll && !form.email.trim() && { backgroundColor: t.accent },
          ]}
        />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="send notification"
        disabled={!canSend}
        onPress={send}
        style={[styles.send, { borderColor: t.accent }, !canSend && styles.dim]}
      >
        <Text style={[label(9.5), { color: t.accent }]}>
          {busy ? 'sending…' : 'send notification'}
        </Text>
      </Pressable>
      {!!reach && !reach.configured && (
        <Text style={[styles.rowCaption, styles.warn, { color: t.inkSoft }]}>
          sender not configured — add the firebase key to the server env first.
        </Text>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: fonts.semibold,
    fontSize: 18,
    marginBottom: 10,
  },
  head: { marginTop: 12, marginBottom: 6 },
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
  send: {
    borderWidth: 1,
    borderRadius: 999,
    alignItems: 'center',
    paddingVertical: 11,
    marginTop: 6,
  },
  dim: { opacity: 0.55 },
  warn: { marginTop: 8, textAlign: 'center' },
});
