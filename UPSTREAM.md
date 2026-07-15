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

Lyrics overlay: reduced motion never enters cinematic mode (deliberate — the
800ms dissolve would be a one-frame snap); "song ended" is a position
heuristic (≥99.5% + paused), not the web's natural-end event.
| src/api/mood.js | src/api/mood.js | |
| src/hooks/useTalkHistory.js | src/hooks/useTalkHistory.js | seed is an explicit call (native greeting waits on the mood fetch) |
| src/screens/TalkScreen.jsx | src/components/chat/TalkAura.jsx + src/screens/desktop/DesktopTalk.jsx | tab screen, not a modal; no now-playing banner (the dock bead stays visible); greeting only claims a mood reading when confidence ≥ 0.5 |
| src/lib/lyricsSync.js | src/screens/overlays/LyricsScreen.jsx (activeIdx + gap windows) | extracted pure so it's testable |
| src/overlays/LyricsOverlay.jsx | src/screens/overlays/LyricsScreen.jsx (+ .css, useCinematicIdle) | fontSize not animated (RN can't, scroll masks it); cinematic depth-of-field = opacity only (RN can't blur text); toggle labels lowercased to the native voice; Fraunces/DancingScript TTFs converted from the web's @fontsource WOFFs |
| src/utils/fmtTime.js | src/utils/fmtTime.js | |
| src/hooks/useRecentSearches.js | src/hooks/useRecentSearches.js | |
| src/playback/queueModel.js (auto-next part) | src/App.jsx fetchAutoNext/applyAutoRadioToQueue | behavior port, not file port |
