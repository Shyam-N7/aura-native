// Mount bounds for the app's long track lists (queue, playlist details,
// liked, history). RN's FlatList defaults keep ~21 viewports of rows mounted —
// for ~60px rows that is effectively "everything": opening a 245-track shared
// playlist mounted all 245 art rows at once, spiking PSS 232→361MB in seconds
// (measured on the RMX3371), which is inside the range where a memory-starved
// Android shoots the app. These bounds cap the open spike at ~14 rows and the
// steady state at ~3 viewports; spread them onto any list whose length the
// user controls.
export const LONG_LIST = {
  initialNumToRender: 14,
  maxToRenderPerBatch: 12,
  updateCellsBatchingPeriod: 40,
  windowSize: 3,
};
