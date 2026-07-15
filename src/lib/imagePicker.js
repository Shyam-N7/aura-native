import { launchImageLibrary } from 'react-native-image-picker';

// One place that talks to the system photo picker. The picker re-encodes to
// the same caps the web's canvas resize used (cover→600px, avatar→256px), so
// uploads stay tiny and well under the server's body limit. Resolves to the
// picked asset ({ uri, type, ... }) or null when the user backs out.
const MAX_DIM = { cover: 600, avatar: 256 };

export async function pickImage(kind = 'cover') {
  const max = MAX_DIM[kind] ?? 600;
  const result = await launchImageLibrary({
    mediaType: 'photo',
    selectionLimit: 1,
    maxWidth: max,
    maxHeight: max,
    quality: 0.85,
  });
  if (result.didCancel) {
    return null;
  }
  if (result.errorCode) {
    throw new Error(result.errorMessage || "couldn't open your photos");
  }
  return result.assets?.[0] ?? null;
}
