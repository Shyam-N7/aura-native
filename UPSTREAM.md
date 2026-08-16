# Upstream-ported files

These files are ports of the web app (`D:\Brave Downloads\AI Music Development`)
and keep the web file's name, exports, and behavior. To sync after a web change:
diff the pair, port the delta, keep the storage/URL adaptations noted below.

Blanket adaptations (apply to every port):

- `localStorage` → MMKV via `src/storage/mmkv.js` (synchronous, same key names)
- `URLSearchParams` → hand-built query strings (RN's implementation is partial)
- cookies → `fetchAuthed` Bearer header / RN cookie jar (`src/lib/auth.js`)

| native | web | notes |
| --- | --- | --- |
| src/api/catalog.js | src/api/catalog.js | album detail arrives with Phase 2D |
| src/api/events.js | src/api/events.js | listening recorder — feeds ALL personalization |
| src/api/related.js | src/api/related.js | |
| src/api/quickPicks.js | src/api/quickPicks.js | |
| src/api/stats.js | src/api/stats.js | |
| src/api/impressions.js | src/api/impressions.js | |
| src/api/discover.js | src/api/discover.js | |
| src/api/library.js | src/api/library.js | |
| src/api/hidden.js | src/api/hidden.js | |
| src/api/likes.js | src/api/likes.js | |
| src/api/autoPlaylists.js | src/api/autoPlaylists.js | |
| src/api/playlists.js | src/api/playlists.js | |
| src/api/uploads.js | src/api/uploads.js | canvas resize swapped for the picker's |
| src/lib/time.js | src/lib/time.js | |
| src/lib/homeCache.js | src/lib/homeCache.js | |
| src/lib/explicit.js | src/lib/explicit.js | |
| src/lib/toast.js | src/lib/toast.js | |
| src/lib/audioQuality.js | src/lib/audioQuality.js | storage backend swapped |
| src/utils/title.js | src/utils/title.js | |
| src/api/lyrics.js | src/api/lyrics.js | DOMException → named Error (Hermes has no DOMException) |
| src/api/talk.js | src/api/talk.js | |
| src/api/why.js | src/api/why.js | |
| src/overlays/WhySheet.jsx | src/screens/overlays/WhyPanel.jsx | bottom sheet, not a player panel; entry moved to the track actions menu (native player has no ⋯ menu); mood attached only when confidence ≥ 0.5 |
| src/api/journal.js | src/api/journal.js | |
| src/api/sonicDna.js | src/api/sonicDna.js | |
| src/screens/JournalScreen.jsx | src/screens/desktop/DesktopJournal.jsx | hydrates entries[].tracks (server sends ID strings; the web renders them as objects so its thumbs never show) |
| src/screens/DnaScreen.jsx | src/screens/desktop/DesktopDna.jsx | unavailable state reads eventsSeen (web reads a `seen` field that never existed); moods show real play counts (web's share% rendered NaN) |
| src/api/mood.js | src/api/mood.js | |
| src/hooks/useTalkHistory.js | src/hooks/useTalkHistory.js | seed is an explicit call (native greeting waits on the mood fetch) |
| src/screens/TalkScreen.jsx | src/components/chat/TalkAura.jsx + src/screens/desktop/DesktopTalk.jsx | tab screen, not a modal; no now-playing banner (the dock bead stays visible); greeting only claims a mood reading when confidence ≥ 0.5 |
| src/lib/lyricsSync.js | src/screens/overlays/LyricsScreen.jsx (activeIdx + gap windows) | extracted pure so it's testable |
| src/overlays/LyricsOverlay.jsx | src/screens/overlays/LyricsScreen.jsx (+ .css, useCinematicIdle) | fontSize not animated (RN can't, scroll masks it); cinematic depth-of-field = opacity only (RN can't blur text); toggle labels lowercased to the native voice; Fraunces/DancingScript TTFs converted from the web's @fontsource WOFFs |
| src/utils/fmtTime.js | src/utils/fmtTime.js | |
| src/hooks/useRecentSearches.js | src/hooks/useRecentSearches.js | |
| src/playback/queueModel.js (auto-next part) | src/App.jsx fetchAutoNext/applyAutoRadioToQueue | behavior port, not file port |
| src/overlays/AddToPlaylistSheet.jsx | src/components/AddToPlaylistSheet.jsx + PlaylistPickerBody.jsx | native-only improvement: for a single track it reads each playlist (getPlaylist) and ticks the ones that already hold it, un-tappable + no "already in" toast (web only learns after tapping). Membership is best-effort (a failed read just omits the tick). |
| src/api/bridges.js | src/api/bridges.js | URLSearchParams → hand-built query |
| src/lib/bridges.js | src/screens/desktop/bridgeCfg.js + BridgeCard MOOD_COLOR + src/data/moodBridges.js | consolidated; BRIDGE_LANGS trimmed to the 5 the server actually threads on (web shows all 14, server drops the rest); +blendHex (sRGB stand-in for the arc's oklab color-mix) |
| src/components/bridges/BridgeItinerary.jsx | src/screens/desktop/BridgeItinerary.jsx | album art overlaid as RN Images (robust vs SVG <Image>+clipPath); arc is a solid mid-blend stroke (gradient-url strokes unreliable on this rn-svg/Fabric build); loading dots are static-faded, not pulsing |
| src/screens/BridgesScreen.jsx | src/screens/desktop/DesktopBridges.jsx | one screen (web split BridgeCard preset grid + itinerary); entry on the You tab (web surfaces it on DesktopHome). sameMood hint is defensive parity — the from/to mood sets are disjoint so it can't trigger via the UI. Two web bugs fixed (review-caught): a stale curate result no longer lands when the moods change mid-flight; a hero build that returns 0 tracks folds the hero instead of spinning "curating" forever. |
| src/lib/auth.js setActiveMode/enableFamilyMode/disableFamilyMode | src/lib/auth.js same | no cross-tab broadcast (web-only) |
| src/overlays/ModeSheet.jsx + src/lib/modeSheet.js | src/components/nav/GooeyModePills.jsx (+ MobileTopBar mode chip) | bottom-sheet picker, not gooey metaball pills; 'car' hidden until the Phase-5 car experience lands (it's a no-op vibe without the drive UI + leveling) |
| src/screens/YouScreen.jsx family-mode group | src/components/SettingsPanel.jsx family form | inline PIN form in the settings shelf; number-pad + secureTextEntry |
| src/lib/ytImportCopy.js | src/lib/ytImportCopy.js | keys and error CODES unchanged (they are the contract with the server); strings lowercased to the native voice. `progress.safeToLeave` rescoped: the web's "leave this screen" is backwards here — the stack keeps parked screens mounted, so opening another screen keeps the poll running and only backing out stops it. +`progress.stalled`/`progress.resume` for the tick cap below |
| src/api/ytImport.js | src/api/ytImport.js | web's hand-rolled `fail()` → the house `apiError` (it already carries `status` + `code`). Every signal-taking call composes its OWN deadline: `fetchAuthed` disables its 15s one the moment a caller passes a signal (`lib/auth.js:557`) and RN's fetch has none, so `pollImport` would otherwise have no timeout at all. A client timeout is raised as `TimeoutError`/`YT_TIMEOUT`, never `AbortError`. `startImport`/`refreshPlaylist` pass `deadlineMs: 45000` for the server's 20s inline drain. `getFeatures` is session-memoised like the link set; both clear on session reset |
| src/hooks/useImportJob.js | src/hooks/useImportJob.js | next tick scheduled in `finally`, so an unexpected throw cannot silently end the loop; `MAX_TICKS` cap (this JS context survives backgrounding for hours, a web tab does not) with a `resume()`; deliberately NOT focus/AppState-gated, unlike the rev-poll in PlaylistScreen — that poll is a read, this one is the worker |
| src/screens/YouTubeImportScreen.jsx | src/screens/YouTubeImportScreen.jsx | hardware back during a live import runs the same stop-import confirm (a stack pop would unmount the hook and stop the drain with no dialog); `autoFocus` is the only paste affordance there is — no clipboard library, no Expo; the serif/italic hero is one line (single typeface, no italic face); `navigation.replace` into the finished playlist. Progress is a live list, not a bar — see the note below |
| src/overlays/YouTubeReview.jsx | src/screens/YouTubeReviewScreen.jsx | a component over its host, not a stack route: two hosts need it (import and playlist-refresh) and `onDone(updated)` must hand back the re-polled job, which navigation params cannot carry |

## Notes that outgrew the table

**YouTube import progress.** The web renders a bar and one line; native renders
a bar, a stage line, and a live list of the songs as they resolve. The list is a
sliding window of 8 rows centred on the song being matched, not the whole
tracklist — the full list looks right for ten seconds, then the frontier scrolls
under the fold and the screen is static again, and auto-scrolling to follow it
fights the user's thumb.

Naming the current song is honest rather than decorative because `matchPhase`
claims items with `ORDER BY position ASC LIMIT 1`: the queue drains strictly in
order, so the first item with no `tier` is the server's actual cursor. Every
line is derived from real counts, so a stalled drain freezes the words and the
bar together instead of easing toward a finish that is not happening. Rows show
YouTube's own title, not the catalog's cleaner one — swapping it at resolve time
would make rows appear to rewrite themselves mid-import.

Native then went further, and this part has not been ported back yet. Under the
stage line sits a **rotating word** (`COPY.progress.words`), an **elapsed
counter**, a **gliding bar**, a **pulsing dot** on the frontier row, and the
house `AuraLoader` during the fetch — the stretch that has nothing to list,
because `fetchPhase` writes every item row in one transaction at the end.

The load-bearing rule: **the word is advanced by the POLL, never by a clock.**
The poll is the server's worker, so a new job object is proof a slice of
matching just ran — an advancing word is evidence of work, which no timer could
claim. A hung poll or a stalled job therefore freezes it with no special case.
Every string in a phase's pool must be true of that whole phase, so which one is
showing carries no information and cannot lie; a test asserts no pool string
contains a digit or the word "of".

The bar uses `scaleX`, never `width: '<pct>%'` — percentage width cannot run on
the UI thread. The frontier pulse is the screen's only repeating animation and
gates on `useAppActive() && useNavFocused()`, because this screen's poll keeps
running while parked and its `BackHandler` invites switching away mid-import:
the work continues, the animation does not. Rows carry `LinearTransition` but
deliberately no `entering` — see the reanimated/Fabric note on `Shelf.jsx`.

**Lyrics overlay.** Reduced motion never enters cinematic mode — deliberate,
the 800 ms dissolve would be a one-frame snap. "Song ended" is a position
heuristic (≥ 99.5% + paused), not the web's natural-end event.

*(This paragraph used to sit between two table rows. Markdown ends a table at
the first non-row line, so everything after it — twelve ports, including every
bridges row and the auth/mode/family entries — rendered as raw pipe-separated
text rather than as part of the table. If another note outgrows a cell, it
goes here.)*

