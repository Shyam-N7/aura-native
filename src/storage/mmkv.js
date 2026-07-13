import { MMKV } from 'react-native-mmkv';

// Synchronous localStorage-shaped wrapper over MMKV so libs ported from the
// web app keep their storage call sites unchanged.
const mmkv = new MMKV();

export const storage = {
  getItem(key) {
    const v = mmkv.getString(key);
    return v === undefined ? null : v;
  },
  setItem(key, value) {
    mmkv.set(key, String(value));
  },
  removeItem(key) {
    mmkv.delete(key);
  },
};
