import { fetchAuthed } from '../lib/auth';

// Ported from web src/api/uploads.js with the resize step swapped: the web
// draws onto a canvas before uploading; native lets the image picker deliver
// an already-resized JPEG (see lib/imagePicker), so this just streams the
// picked file's bytes to the server. `kind` is 'cover' or 'avatar'.
// Returns { url } (a Blob URL the playlist/account endpoints accept).
export async function uploadImage(asset, { kind = 'cover' } = {}) {
  const picked = await fetch(asset.uri);
  const blob = await picked.blob();
  const res = await fetchAuthed(
    `/api/uploads/image?kind=${encodeURIComponent(kind)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': asset.type ?? 'image/jpeg' },
      body: blob,
      // A multi-MB image on a slow uplink outlives the 15s default honestly.
      deadlineMs: 60000,
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `upload failed (${res.status})`);
  }
  return body; // { url }
}
