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
| src/api/playlists.js | src/api/playlists.js | listPlaylists only; rest is Phase 3 |
| src/lib/homeCache.js | src/lib/homeCache.js | |
| src/lib/explicit.js | src/lib/explicit.js | |
| src/lib/toast.js | src/lib/toast.js | |
| src/lib/audioQuality.js | src/lib/audioQuality.js | storage backend swapped |
| src/utils/title.js | src/utils/title.js | cleanLyric stays behind until lyrics (Phase 4) |
| src/utils/fmtTime.js | src/utils/fmtTime.js | |
| src/hooks/useRecentSearches.js | src/hooks/useRecentSearches.js | |
| src/playback/queueModel.js (auto-next part) | src/App.jsx fetchAutoNext/applyAutoRadioToQueue | behavior port, not file port |
