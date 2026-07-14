/* eslint-env jest */
require('react-native-gesture-handler/jestSetup');

// Worklets binds a native module at import; its shipped mock must be installed
// BEFORE reanimated loads (reanimated 4 initializes worklets on import).
jest.mock('react-native-worklets', () =>
  require('react-native-worklets/lib/module/mock'),
);
require('react-native-reanimated').setUpTests();

// Skia ships an official node mock.
jest.mock('@shopify/react-native-skia', () =>
  require('@shopify/react-native-skia/lib/commonjs/mock'),
);

// react-native-mmkv binds a native TurboModule at import — swap in an
// in-memory store so storage-backed libs run under jest.
jest.mock('react-native-mmkv', () => {
  class MMKV {
    constructor() {
      this.map = new Map();
    }
    getString(key) {
      return this.map.has(key) ? this.map.get(key) : undefined;
    }
    set(key, value) {
      this.map.set(key, String(value));
    }
    delete(key) {
      this.map.delete(key);
    }
  }
  return { MMKV };
});

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
