import React, { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeContext';
import { TOPBAR_CLEARANCE } from '../components/nav/TopBar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DOCK_CLEARANCE } from '../components/nav/Dock';
import { usePlayer } from '../playback/PlayerContext';
import { talk } from '../api/talk';
import { getCurrentMood } from '../api/mood';
import {
  addTalkMessage,
  resetTalkHistory,
  seedTalkHistory,
  useTalkHistory,
} from '../hooks/useTalkHistory';
import { getUser } from '../lib/auth';
import { Icon } from '../components/Icon';
import { PressScale } from '../components/ui/PressScale';
import { fonts, label } from '../theme/tokens';

// Ported from web TalkAura.jsx (mobile) + DesktopTalk.jsx: the conversational
// DJ. The web mobile modal carries a now-playing banner because it covers the
// dock — here the dock (and its bead) stays visible, so the banner is
// redundant and the chat gets the room instead.

const SUGGESTIONS = [
  'Take me somewhere quieter',
  'I need to focus',
  'Something with more weight',
  'Play tamil indie',
];

const GENERIC_SEED =
  'Tell me what you want to hear, how you feel, or where to take you next.';
const moodSeed = mood =>
  `I'm reading you as ${mood} right now. The set is built around that — but tell me how it actually feels and i'll shift it.`;

function ThinkingDot({ index, inkFaint, reduced }) {
  const v = useSharedValue(0.3);
  useEffect(() => {
    if (reduced) {
      v.value = 0.6;
      return undefined;
    }
    v.value = withDelay(
      index * 180,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 300, easing: Easing.inOut(Easing.sin) }),
          withTiming(0.3, { duration: 300, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(v);
  }, [index, reduced, v]);
  const style = useAnimatedStyle(() => ({ opacity: v.value }));
  return (
    <Animated.View
      style={[styles.thinkingDot, { backgroundColor: inkFaint }, style]}
    />
  );
}

export default function TalkScreen() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const player = usePlayer();
  const reduced = useReducedMotion();
  const { messages } = useTalkHistory();
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [mood, setMood] = useState(null);
  const scrollRef = useRef(null);
  const seeding = useRef(false);

  const dj = getUser()?.djName || 'AURA';

  // First-ever load (and after a clear): greet with the live mood reading if
  // the server is confident, otherwise a plain invitation — never a guess.
  useEffect(() => {
    if (messages.length > 0 || seeding.current) {
      return undefined;
    }
    seeding.current = true;
    let on = true;
    getCurrentMood()
      .then(snap => {
        if (on && snap?.mood) {
          setMood(snap.mood);
        }
        if (on) {
          seedTalkHistory({
            who: 'aura',
            text:
              snap?.mood && snap.confidence >= 0.5
                ? moodSeed(snap.mood)
                : GENERIC_SEED,
          });
          seeding.current = false;
        }
      })
      .catch(() => {
        if (on) {
          seedTalkHistory({ who: 'aura', text: GENERIC_SEED });
          seeding.current = false;
        }
      });
    return () => {
      on = false;
    };
  }, [messages.length]);

  useEffect(() => {
    const id = setTimeout(
      () => scrollRef.current?.scrollToEnd({ animated: true }),
      50,
    );
    return () => clearTimeout(id);
  }, [messages.length, thinking]);

  const send = async text => {
    const trimmed = text.trim();
    if (!trimmed || thinking) {
      return;
    }
    const youMsg = { who: 'you', text: trimmed };
    const nextHistory = [...messages, youMsg];
    addTalkMessage(youMsg);
    setDraft('');
    setThinking(true);
    try {
      const { reply, tracks, action, suggestions } = await talk({
        message: trimmed,
        history: nextHistory,
        context: { mood },
      });
      const intentCount =
        typeof action?.count === 'number' && action.count > 0
          ? action.count
          : (tracks?.length ?? 0);
      addTalkMessage({
        who: 'aura',
        text: reply,
        tracks: tracks?.length ? tracks : null,
        intentCount,
        suggestions: suggestions?.length ? suggestions : undefined,
      });
    } catch (err) {
      addTalkMessage({
        who: 'aura',
        text: `Couldn't reach the dj — ${err.message}`,
        error: true,
      });
    } finally {
      setThinking(false);
    }
  };

  const playSet = tracks => {
    if (!tracks?.length) {
      return;
    }
    player.playQueue(tracks, 0, 'suggested for you');
    player.ui?.openPlayer?.();
  };

  const clear = () => {
    resetTalkHistory();
    // The seeding effect re-runs on the now-empty history and re-greets.
  };

  // Chips follow the conversation: latest aura turn with suggestions wins,
  // the static list covers the first turn and error turns.
  const latest = [...messages]
    .reverse()
    .find(m => m.who === 'aura' && m.suggestions?.length);
  const chips = latest?.suggestions ?? SUGGESTIONS;

  return (
    <View
      style={[
        styles.root,
        // Clearance for the single floating top bar (TopBarHost) — the
        // per-screen in-flow bar is gone.
        { backgroundColor: t.bg, paddingTop: insets.top + TOPBAR_CLEARANCE },
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.heading, { color: t.ink }]}>Talk</Text>
        {messages.length > 1 && (
          <PressScale
            accessibilityRole="button"
            accessibilityLabel="clear conversation"
            onPress={clear}
            hitSlop={8}
          >
            <Text style={[label(9.5), { color: t.inkFaint }]}>Clear</Text>
          </PressScale>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.fill}
        contentContainerStyle={styles.thread}
        keyboardShouldPersistTaps="handled"
      >
        {messages.map((m, i) => {
          const isAura = m.who === 'aura';
          return (
            <View
              key={i}
              style={[styles.msg, isAura ? styles.msgAura : styles.msgYou]}
            >
              <Text style={[label(isAura ? 11 : 9), { color: t.inkFaint }]}>
                {isAura ? dj : 'You'}
              </Text>
              <View
                style={
                  isAura ? null : [styles.youBubble, { backgroundColor: t.line }]
                }
              >
                <Text
                  style={[
                    styles.msgText,
                    { color: m.error ? t.inkSoft : t.ink },
                  ]}
                >
                  {m.text}
                </Text>
              </View>
              {!!m.tracks && (
                <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={
                    (m.intentCount ?? m.tracks.length) === 1
                      ? 'play song'
                      : `play set of ${m.tracks.length}`
                  }
                  onPress={() => playSet(m.tracks)}
                  style={[styles.playSet, { borderColor: t.accent }]}
                >
                  <View
                    style={[styles.playSetDot, { backgroundColor: t.accent }]}
                  >
                    <Icon name="play" size={11} color={t.bg} />
                  </View>
                  <Text style={[label(9.5), { color: t.ink }]}>
                    {(m.intentCount ?? m.tracks.length) === 1
                      ? 'Play song'
                      : `Play set · ${m.tracks.length}`}
                  </Text>
                </PressScale>
              )}
            </View>
          );
        })}
        {thinking && (
          <View style={styles.thinking}>
            {[0, 1, 2].map(i => (
              <ThinkingDot
                key={i}
                index={i}
                inkFaint={t.inkFaint}
                reduced={reduced}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.chips}>
        {chips.map((s, i) => (
          <PressScale
            key={i}
            accessibilityRole="button"
            accessibilityLabel={s}
            onPress={() => send(s)}
            disabled={thinking}
            hitSlop={CHIP_HIT}
            style={[
              styles.chip,
              { borderColor: t.line },
              thinking && styles.dim,
            ]}
          >
            <Text style={[styles.chipText, { color: t.inkSoft }]}>{s}</Text>
          </PressScale>
        ))}
      </View>

      <View style={[styles.compose, { borderTopColor: t.line }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={`Tell ${dj} how it feels…`}
          placeholderTextColor={t.inkFaint}
          cursorColor={t.accent}
          selectionColor={t.accent}
          style={[styles.input, { color: t.ink }]}
          returnKeyType="send"
          onSubmitEditing={() => send(draft)}
          accessibilityLabel="talk message"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="send"
          onPress={() => send(draft)}
          disabled={thinking || !draft.trim()}
          style={[
            styles.sendBtn,
            { backgroundColor: t.accent },
            (thinking || !draft.trim()) && styles.dim,
          ]}
        >
          <Icon name="arrow-right" size={16} color={t.bg} />
        </Pressable>
      </View>
    </View>
  );
}

// The chips are the smallest control in the app: 10dp of text inside 5dp of
// padding is ~22dp tall. Growing the padding would fatten a bordered pill the
// design deliberately keeps small, so the extra reach is pure hitSlop —
// 22 + 28 vertical = ~50dp, 20dp wider than the pill horizontally.
const CHIP_HIT = { top: 14, bottom: 14, left: 10, right: 10 };

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 6,
  },
  heading: {
    fontFamily: fonts.semibold,
    fontSize: 26,
  },
  thread: {
    paddingHorizontal: 22,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 14,
  },
  msg: { maxWidth: '85%', gap: 4 },
  msgAura: { alignSelf: 'flex-start' },
  msgYou: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  youBubble: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  msgText: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 20,
  },
  playSet: {
    marginTop: 6,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 6,
    paddingRight: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  playSetDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thinking: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: 4,
    paddingVertical: 4,
  },
  thinkingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 22,
    paddingVertical: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: {
    fontFamily: fonts.medium,
    fontSize: 10,
    letterSpacing: 1,
  },
  dim: { opacity: 0.5 },
  compose: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    paddingTop: 8,
    paddingHorizontal: 14,
    paddingBottom: DOCK_CLEARANCE + 8,
  },
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 16,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
