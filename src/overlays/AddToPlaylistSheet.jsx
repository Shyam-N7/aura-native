import React, { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import {
  listPlaylists,
  createPlaylist,
  addToPlaylist,
} from '../api/playlists';
import { subscribeAddToPlaylist } from '../lib/addToPlaylistSheet';
import { showToast } from '../lib/toast';
import { TrackArt } from '../components/TrackRow';
import { Sheet } from '../components/ui/Sheet';
import { fonts, label, radii } from '../theme/tokens';
import { cleanTitle } from '../utils/title';

// "Add to playlist" bottom sheet, ported from web AddToPlaylistSheet +
// PlaylistPickerBody: user playlists + inline "new playlist" row. Sequential
// adds keep deterministic ordering; duplicate errors are skipped silently so
// a bulk add doesn't blow up — the success toast distinguishes the
// all-duplicates case.
function PickerBody({ tracks, onPicked }) {
  const { t } = useTheme();
  const [playlists, setPlaylists] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busyName, setBusyName] = useState(null);

  useEffect(() => {
    const ctl = new AbortController();
    listPlaylists({ signal: ctl.signal })
      .then(setPlaylists)
      .catch(err => {
        if (err.name !== 'AbortError') {
          showToast(`Couldn't load playlists — ${err.message}`);
          setPlaylists([]);
        }
      });
    return () => ctl.abort();
  }, []);

  const addAll = async playlistId => {
    let added = 0;
    for (const track of tracks) {
      try {
        await addToPlaylist(playlistId, track.id);
        added++;
      } catch (err) {
        if (err.code !== 'duplicate') {
          throw err;
        }
      }
    }
    return added;
  };

  const successToast = (playlistName, added) => {
    if (tracks.length === 1) {
      showToast(
        added === 1
          ? `Added to ${playlistName}.`
          : `Already in ${playlistName}.`,
      );
    } else if (added === 0) {
      showToast(`All tracks already in ${playlistName}.`);
    } else if (added === tracks.length) {
      showToast(`Added ${added} tracks to ${playlistName}.`);
    } else {
      showToast(`Added ${added} of ${tracks.length} to ${playlistName}.`);
    }
  };

  const pick = async playlist => {
    if (busyName) {
      return;
    }
    setBusyName(playlist.name);
    try {
      const added = await addAll(playlist.id);
      successToast(playlist.name, added);
      onPicked();
    } catch (err) {
      showToast(`Couldn't add — ${err.message}`);
      setBusyName(null);
    }
  };

  const submitNew = async () => {
    const name = newName.trim();
    if (!name) {
      setCreating(false);
      setNewName('');
      return;
    }
    setBusyName(name);
    try {
      const playlist = await createPlaylist({ name });
      const added = await addAll(playlist.id);
      successToast(playlist.name, added);
      onPicked();
    } catch (err) {
      showToast(`Couldn't create — ${err.message}`);
      setBusyName(null);
    }
  };

  if (busyName) {
    return (
      <Text style={[styles.stateLine, { color: t.inkFaint }]}>
        adding to {busyName}
      </Text>
    );
  }

  return (
    <>
      {creating ? (
        <View style={styles.create}>
          <Text style={[label(9.5), { color: t.inkFaint }]}>New playlist</Text>
          <TextInput
            autoFocus
            value={newName}
            onChangeText={setNewName}
            onSubmitEditing={submitNew}
            placeholder="Name your playlist"
            placeholderTextColor={t.inkFaint}
            style={[
              styles.input,
              { color: t.ink, borderColor: t.line, backgroundColor: t.bg },
            ]}
          />
          <View style={styles.createActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="cancel"
              onPress={() => {
                setCreating(false);
                setNewName('');
              }}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Text style={[styles.createBtn, { color: t.inkSoft }]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="create"
              disabled={!newName.trim()}
              onPress={submitNew}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Text
                style={[
                  styles.createBtn,
                  { color: newName.trim() ? t.accent : t.inkFaint },
                ]}
              >
                Create
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="new playlist"
          onPress={() => setCreating(true)}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <View style={[styles.coverFallback, { backgroundColor: t.accentSoft }]}>
            <Text style={[styles.coverPlus, { color: t.accent }]}>+</Text>
          </View>
          <Text style={[styles.rowName, { color: t.ink }]}>New playlist</Text>
        </Pressable>
      )}

      {playlists === null && (
        <Text style={[styles.stateLine, { color: t.inkFaint }]}>
          Loading playlists
        </Text>
      )}
      {playlists !== null && playlists.length === 0 && !creating && (
        <Text style={[styles.stateLine, { color: t.inkSoft }]}>
          You don't have any playlists yet. Tap "New playlist" above.
        </Text>
      )}

      {(playlists ?? []).map(p => (
        <Pressable
          key={p.id}
          accessibilityRole="button"
          accessibilityLabel={`add to ${p.name}`}
          onPress={() => pick(p)}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <TrackArt
            track={{ id: p.id, title: p.name, imageUrl: p.coverImageUrl }}
            size={38}
            radius={6}
          />
          <View style={styles.rowMeta}>
            <Text numberOfLines={1} style={[styles.rowName, { color: t.ink }]}>
              {p.name}
            </Text>
            <Text style={[label(8.5), { color: t.inkFaint }]}>
              {p.trackCount} {p.trackCount === 1 ? 'track' : 'tracks'}
            </Text>
          </View>
        </Pressable>
      ))}
    </>
  );
}

export function AddToPlaylistSheet() {
  const { t } = useTheme();
  const [event, setEvent] = useState(null);

  useEffect(() => subscribeAddToPlaylist(setEvent), []);

  if (!event) {
    return null;
  }
  const tracks = event.tracks;
  const sublabel =
    tracks.length === 1
      ? cleanTitle(tracks[0].title ?? '')
      : `${tracks.length} tracks`;

  return (
    <Sheet
      onClose={() => setEvent(null)}
      closeLabel="close add to playlist"
      // Long playlist collections scroll under the pinned title (they used to
      // clip at the sheet's max height); the header stays the drag zone.
      header={
        <>
          <Text style={[styles.title, { color: t.ink }]}>Add to playlist</Text>
          <Text
            numberOfLines={1}
            style={[label(9.5), styles.subtitle, { color: t.inkFaint }]}
          >
            {sublabel}
          </Text>
        </>
      }
    >
      <PickerBody
        key={event.id}
        tracks={tracks}
        onPicked={() => setEvent(null)}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.semibold, fontSize: 18 },
  subtitle: { marginTop: 3, marginBottom: 8 },
  stateLine: {
    fontFamily: fonts.regular,
    fontSize: 13.5,
    paddingVertical: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
  },
  pressed: { opacity: 0.6 },
  rowMeta: { flex: 1, minWidth: 0, gap: 2 },
  rowName: { fontFamily: fonts.medium, fontSize: 15 },
  coverFallback: {
    width: 38,
    height: 38,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverPlus: { fontFamily: fonts.regular, fontSize: 20 },
  create: { paddingVertical: 8, gap: 8 },
  input: {
    borderWidth: 1,
    borderRadius: radii.input,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: fonts.regular,
    fontSize: 15,
  },
  createActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 22,
    paddingVertical: 4,
  },
  createBtn: { fontFamily: fonts.medium, fontSize: 14.5 },
});
