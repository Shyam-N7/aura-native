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

// The Goo metaball is Skia-filter decoration (pointerEvents none). The Skia
// node mock doesn't provide the Group/Paint/Blur/ColorMatrix primitives it
// composes, so render it as nothing under jest — its children never paint.
jest.mock('./src/components/ui/Goo', () => ({ Goo: () => null }));

// CountUp animates via withTiming, which the reanimated jest clock never
// finishes on its own — tests would read the rolling number mid-flight (0).
// Stub it to the final value: tests assert the truth, devices get the roll.
jest.mock('./src/components/ui/CountUp', () => ({
  CountUp: ({ to = 0 }) => String(to),
}));

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

// The image picker binds a native module at import — resolve as "backed out"
// so upload flows are inert under jest.
jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(async () => ({ didCancel: true })),
}));
