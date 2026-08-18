// Sort options for the track-collection screens, beside the ListTools row
// that renders them.
//
// PlaylistScreen and CatalogPlaylistScreen declared these independently while
// persisting the chosen id to the SAME MMKV key. Byte-identical today, so it
// worked; the failure it was set up for is one screen gaining an option the
// other doesn't have. The shared key then hands the second screen an id that
// isn't in its own list — the segmented slider has no segment to sit on and
// the rows fall back to source order, on a screen that says it is sorted.
//
// The key and the array are exported together because that is the coupling:
// the key stores an `id` from the array, so they cannot be changed apart.
export const PLAYLIST_SORT_KEY = 'aura.sortPlaylist';

export const PLAYLIST_SORTS = [
  { id: 'default', label: 'In order' },
  { id: 'title', label: 'Title' },
  { id: 'artist', label: 'Artist' },
  { id: 'longest', label: 'Longest' },
];

// Liked songs keeps its own key and its own list on purpose: its natural order
// is recency, not a curated sequence, so 'default' means something different
// there and must not be renamed in step with the two above.
export const LIKED_SORT_KEY = 'aura.sortLiked';

export const LIKED_SORTS = [
  { id: 'default', label: 'Recent' },
  { id: 'title', label: 'Title' },
  { id: 'artist', label: 'Artist' },
  { id: 'longest', label: 'Longest' },
];
