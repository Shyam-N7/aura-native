// Mount bounds for the app's long track lists (queue, playlist details,
// liked, history). RN's FlatList defaults keep ~21 viewports of rows mounted —
// for ~60px rows that is effectively "everything": opening a 245-track shared
// playlist mounted all 245 art rows at once, on a device whose kernel
// OOM-kills the biggest resident app. These bounds cap the open spike at ~14
// rows and the steady state at ~3 viewports; spread them onto any list whose
// length the user controls.
//
// THE NUMBER THAT USED TO BE HERE WAS STALE, AND IT HAD BEEN LOAD-BEARING.
// This comment said the spike was "PSS 232→361MB in seconds (measured on the
// RMX3371)". That was measured against the ScrollView implementation these
// bounds REPLACED. Re-measured on the same device after windowing landed,
// opening a 289-track playlist costs +37 MB (reports/04-baseline.md:72,
// reports/01-stability.md:135) — an order of magnitude less. The stale figure
// was still being quoted as the reason the window could not move.
//
// So treat these four values as what they are: only `initialNumToRender` has a
// measurement anywhere near it. windowSize, maxToRenderPerBatch and
// updateCellsBatchingPeriod have NEVER been measured — reports/02-review.md:138
// says so outright, and OPTIMIZATION-PLAYBOOK.md calls them "untested
// assumptions, not settings". windowSize: 3 is aggressive, it trades blank
// cells during a fling for memory, and with the real cost an order of
// magnitude lower than the number that justified it, it may be buying very
// little. Re-derive it before defending it again.
export const LONG_LIST = {
  initialNumToRender: 14,
  maxToRenderPerBatch: 12,
  updateCellsBatchingPeriod: 40,
  windowSize: 3,
};
