import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, StatusBar, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import {
  NavigationContainer,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { PlayerProvider, usePlayer } from './src/playback/PlayerContext';
import { getTrack } from './src/api/catalog';
import { mark } from './src/lib/perfMarks';
import { acceptPlaylistInvite } from './src/api/playlists';
import { showToast } from './src/lib/toast';
import { PlayerSheet } from './src/overlays/PlayerSheet';
import { LyricsOverlay } from './src/overlays/LyricsOverlay';
import { QueueSheet } from './src/overlays/QueueSheet';
import { TrackActionsSheet } from './src/overlays/TrackActionsSheet';
import { AddToPlaylistSheet } from './src/overlays/AddToPlaylistSheet';
import { SleepTimerSheet } from './src/overlays/SleepTimerSheet';
import { WhySheet } from './src/overlays/WhySheet';
import { ModeSheet } from './src/overlays/ModeSheet';
import { QualitySheet } from './src/overlays/QualitySheet';
import { WhatsNewSheet } from './src/overlays/WhatsNewSheet';
import { ConfirmSheet } from './src/overlays/ConfirmSheet';
import { PresenceAgent } from './src/overlays/PresenceAgent';
import { QuietPanelSheet } from './src/overlays/QuietPanelSheet';
import { Toast } from './src/components/Toast';
import { Dock } from './src/components/nav/Dock';
import RootTabs from './src/navigation/RootTabs';
import AuthScreen from './src/screens/AuthScreen';
import { SensingScreen } from './src/screens/SensingScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import {
  API_BASE,
  getUser,
  subscribeAuth,
  showSensing,
  hasOnboarded,
  fetchMe,
} from './src/lib/auth';
import { initPush, setPushLinkHandler } from './src/lib/push';
import { freezeGlass } from './src/lib/navFreeze';
import { initEqualizer } from './src/lib/equalizer';
import { sensingShownToday, markSensingShown } from './src/lib/sensing';
import { onSessionReset, resetSessionState } from './src/lib/sessionReset';
// Imported for their side effect: each registers its own session teardown with
// the registry above. Without a reference here a store that no mounted screen
// has imported yet would never register — and Home/likes are exactly the ones
// whose stale state is visible on the first screen after a switch.
import './src/lib/homeCache';
import './src/hooks/useLikes';
import './src/hooks/useRecentSearches';
import './src/hooks/useTalkHistory';
import './src/lib/privateSession';
import './src/api/impressions';

// Share links the app answers (web parity): /playlists?join=TOKEN joins a
// playlist invite, /p/PUBLIC_ID opens a public playlist read-only.
//
// A token used to be marked handled BEFORE the network call and never
// released, so one failed join — a 503, a flaky moment — killed the link for
// the rest of the process. Tapping it again did nothing at all: no toast, no
// navigation, no way to tell the app was ignoring you. The obvious recovery
// for a transient failure was the one thing that could not work.
//
// Now a token is only remembered once it has actually been accepted, and what
// it is remembered WITH is the playlist it produced — so re-tapping a link you
// already joined takes you back to the playlist instead of silently doing
// nothing. `joining` is the double-accept guard the Set used to be, held only
// while a request is in flight.
const joinedPlaylists = new Map(); // token → playlistId, successful joins only
const joining = new Set();

// Per-account, like everything else keyed to a signed-in user: a token the
// PREVIOUS account accepted would otherwise send the next one to a playlist
// they are not a member of. Same registry the stores use.
onSessionReset(() => {
  joinedPlaylists.clear();
  joining.clear();
});

// Only OUR links are actionable. Both hosts the manifest declares an intent
// filter for — www (autoVerify) and the apex (chooser) — derived from the one
// origin the app talks to rather than restated.
const LINK_HOSTS = new Set([
  new URL(API_BASE).hostname,
  new URL(API_BASE).hostname.replace(/^www\./, ''),
]);

// `new URL` parses anything, so pathname/searchParams alone say nothing about
// WHO sent the link — and both feeds into handleLink are untrusted. MainActivity
// is exported and singleTask, so any installed app can send an explicit-component
// ACTION_VIEW carrying an arbitrary URI and bypass the manifest's host filter
// entirely; and push data.link is free text typed in the admin console. The
// branch that actually costs something is `join`, which POSTs an invite
// acceptance under the signed-in user — a link from anywhere could enrol them
// in a stranger's playlist. Scheme is pinned too: http:// and app:// forms of
// our own host must not count.
const isOwnLink = u => u.protocol === 'https:' && LINK_HOSTS.has(u.hostname);

// Post-auth gate order (web parity): a signed-in user sees the ~6s sensing
// welcome at most once a day, then the first-run onboarding if they haven't set
// up, then the app. Ranked so a late /me refresh can advance the gate (e.g. skip
// onboarding once the server confirms it) but never regress a finished step.
const FLOW_RANK = { auth: 0, sensing: 1, onboarding: 2, main: 3 };
function computeFlow(u) {
  if (!u) {
    return 'auth';
  }
  if (showSensing() && !sensingShownToday()) {
    return 'sensing';
  }
  if (!hasOnboarded()) {
    return 'onboarding';
  }
  return 'main';
}

function Shell() {
  const { name, t } = useTheme();
  const [user, setUser] = useState(getUser);
  const [flow, setFlow] = useState(() => computeFlow(getUser()));
  const lastUid = useRef(getUser()?.id ?? null);
  const navRef = useNavigationContainerRef();
  // handleLink must stay referentially stable (the push effect tears down and
  // re-inits FCM when it changes), so the player is reached through a ref
  // rather than a dependency.
  const player = usePlayer();
  const playerRef = useRef(player);
  playerRef.current = player;
  const pendingLinkRef = useRef(null);
  useEffect(
    () =>
      subscribeAuth(() => {
        const u = getUser();
        const uid = u?.id ?? null;
        setUser(u);
        setFlow(prev => {
          const next = computeFlow(u);
          if (uid !== lastUid.current) {
            lastUid.current = uid; // real login / logout / switch — reset the gate
            // Module caches are per-process, not per-account: without this the
            // next account inherits the previous one's state until the app is
            // killed. Disk snapshots are owner-stamped already; module scope is
            // not, and clearSession only reaches the disk.
            //
            // This used to name the two stores it knew about, which is exactly
            // why recent searches, talk history, the impression guard and the
            // push token all leaked — nobody thought to come back here. Stores
            // now register their own teardown (lib/sessionReset) and the shell
            // just fires them.
            resetSessionState({ signedOut: uid == null });
            return next;
          }
          // Same user: only ever advance, so a preference refresh can't bounce a
          // user back into a step they just finished.
          return FLOW_RANK[next] > FLOW_RANK[prev] ? next : prev;
        });
      }),
    [],
  );
  // Boot-timing: the shell's first commit — everything before this is JS
  // module init + Sentry + providers.
  useEffect(() => {
    mark('first-render');
  }, []);

  const finishSensing = useCallback(() => {
    markSensingShown();
    setFlow(hasOnboarded() ? 'main' : 'onboarding');
  }, []);
  const finishOnboarding = useCallback(() => setFlow('main'), []);

  const handleLink = useCallback(
    url => {
      if (!url) {
        return;
      }
      // A link that arrives before sign-in/nav is HELD, not dropped — the
      // person who tapped a shared song and then had to sign up must still
      // land on that song. Replayed from NavigationContainer's onReady.
      if (!getUser() || !navRef.isReady()) {
        pendingLinkRef.current = url;
        return;
      }
      let parsed;
      let params;
      try {
        parsed = new URL(url);
        // RN's URLSearchParams decodes every pair in its constructor, so a
        // truncated % escape throws URIError here, not in new URL — and this
        // runs synchronously inside the native 'url' callback and push's
        // linkHandler (data.link is free text typed in the admin console),
        // where a throw kills the app. A malformed link is dropped instead.
        params = parsed.searchParams;
      } catch {
        return;
      }
      if (!isOwnLink(parsed)) {
        return;
      }
      const join = params.get('join');
      if (join) {
        const already = joinedPlaylists.get(join);
        if (already) {
          navRef.navigate('Playlist', { id: already });
          return;
        }
        if (joining.has(join)) {
          return; // same link fired twice — one accept, not two
        }
        joining.add(join);
        acceptPlaylistInvite(join)
          .then(({ playlistId, name: plName, inviterName }) => {
            joinedPlaylists.set(join, playlistId);
            const which = plName ? `"${plName}"` : 'the playlist';
            showToast(
              inviterName
                ? `Joined ${which} — shared by ${inviterName}.`
                : `Joined ${which}.`,
            );
            navRef.navigate('Playlist', { id: playlistId });
          })
          .catch(err => showToast(err.message))
          .finally(() => joining.delete(join));
        return;
      }
      if (parsed.pathname.startsWith('/p/')) {
        const publicId = parsed.pathname.slice(3).split('/')[0];
        if (publicId) {
          navRef.navigate('Playlist', { publicId });
        }
        return;
      }
      // Shared song links: /t/<id>, optionally ?at=<sec> for a moment. Fetch,
      // play, seek — the seek rides the player's op queue, so it lands after
      // the load it belongs to.
      if (parsed.pathname.startsWith('/t/')) {
        const trackId = parsed.pathname.slice(3).split('/')[0];
        if (!trackId) {
          return;
        }
        const at = Number(params.get('at'));
        getTrack(trackId)
          .then(track => {
            const p = playerRef.current;
            p.playTrack(track, { source: 'shared with you' });
            if (Number.isFinite(at) && at > 0) {
              p.seekTo(at);
              // Starting mid-song should read as intended, not broken.
              const m = Math.floor(at / 60);
              const s = String(Math.floor(at % 60)).padStart(2, '0');
              showToast(`starting from ${m}:${s} — a shared moment.`);
            }
            p.ui?.openPlayer?.();
          })
          .catch(() => showToast("couldn't open that song."));
      }
    },
    [navRef],
  );

  useEffect(() => {
    const sub = Linking.addEventListener('url', e => handleLink(e.url));
    return () => sub.remove();
  }, [handleLink]);

  // One profile refresh per launch. The cached user only updated on sign-in
  // or after a 401 forced a revalidation — anything granted server-side since
  // (the admin flag, settings changed on the web) never reached a signed-in
  // phone. Best-effort: offline launches keep the cache.
  useEffect(() => {
    if (getUser()) {
      fetchMe().catch(() => {});
    }
  }, []);

  // Ask the device what its equalizer offers, and re-apply the user's curve if
  // they had it on. Cheap and silent when it's off (the default) — nothing is
  // attached to the audio session until they enable it.
  useEffect(() => {
    initEqualizer().catch(() => {});
  }, []);

  // Push wiring for the signed-in shell: tapped notifications carry a link
  // and ride the SAME handler as share links; foreground pushes become the
  // house toast (see lib/push). Keyed on the user's ID, not the object —
  // every profile edit re-notifies auth with a fresh object, and each one
  // was tearing down + re-initing FCM and re-POSTing the registration.
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) {
      return undefined;
    }
    setPushLinkHandler(handleLink);
    const unsub = initPush();
    return () => {
      setPushLinkHandler(null);
      unsub();
    };
  }, [userId, handleLink]);

  let content;
  if (!user || flow === 'auth') {
    content = <AuthScreen />;
  } else if (flow === 'sensing') {
    content = <SensingScreen name={user.name} onReady={finishSensing} />;
  } else if (flow === 'onboarding') {
    content = <OnboardingScreen onDone={finishOnboarding} />;
  } else {
    content = (
      <NavigationContainer
        ref={navRef}
        // Every push/pop/tab change: freeze the glass capture loop for the
        // transition window (see lib/navFreeze — the exit-glitch fix).
        onStateChange={freezeGlass}
        onReady={() =>
          Linking.getInitialURL()
            .then(u => {
              // The launch intent survives the auth/onboarding gates on its
              // own; the pending ref covers a link that ARRIVED while gated.
              const link = u ?? pendingLinkRef.current;
              pendingLinkRef.current = null;
              handleLink(link);
            })
            // Nobody is waiting on this promise, so a native getInitialURL
            // failure would land as a silent unhandled rejection.
            .catch(() => {})
        }
      >
        <RootTabs />
        {/* The dock floats above every screen, detail pages included (web
            parity); the player and sheets still stack over it. */}
        <Dock navRef={navRef} />
        <PlayerSheet />
        {/* Lyrics ride above the player; closing them lands back there. */}
        <LyricsOverlay />
        {/* The queue rides above the player; closing it lands back there. */}
        <QueueSheet />
        {/* Action sheets stack above both (JSX order = z-order). */}
        <TrackActionsSheet />
        <AddToPlaylistSheet />
        <SleepTimerSheet />
        <WhySheet />
        <ModeSheet />
        <QualitySheet />
        {/* One-time feature guide per update batch; reopenable from You. */}
        <WhatsNewSheet />
        {/* The house confirm — replaces every OS Alert dialog. */}
        <ConfirmSheet />
        {/* The quiet panel — presence + recorded feed behind the home bell. */}
        <QuietPanelSheet />
        {/* Headless: heartbeats + cross-device presence, published to the
            home now-playing card via lib/presenceFeed (no floating pills). */}
        <PresenceAgent />
      </NavigationContainer>
    );
  }

  return (
    <>
      <StatusBar
        barStyle={name === 'midnight' ? 'light-content' : 'dark-content'}
        backgroundColor={t.bg}
      />
      {content}
      <Toast />
    </>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ThemeProvider>
          <PlayerProvider>
            <Shell />
          </PlayerProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
