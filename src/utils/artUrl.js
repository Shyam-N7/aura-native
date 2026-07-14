// Catalog image urls carry an "NxN" size token (e.g. ..._150x150.jpg) — swap
// it so lists load the small variant and heroes/backdrops the large one.
export function artUrl(track, res = 150) {
  const url = track?.imageUrl;
  return url ? url.replace(/\d+x\d+/, `${res}x${res}`) : null;
}
