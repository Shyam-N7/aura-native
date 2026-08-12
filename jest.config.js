module.exports = {
  preset: 'react-native',
  // The react-native preset's transform regex omits .jsx (js|ts|tsx only) and a config-level
  // `transform` replaces the preset's wholesale — so both entries live here, with .jsx added.
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest',
    '^.+\\.(bmp|gif|jpg|jpeg|mp4|png|psd|svg|webp)$': require.resolve(
      'react-native/jest/assetFileTransformer.js',
    ),
  },
  // Preset only whitelists react-native/@react-native for transformation; the
  // nav/svg/safe-area/gesture packages (and their jest mocks) ship TS/ESM.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|@sentry|@shopify/react-native-skia|react-native-.*)/)',
  ],
  // Concatenated after the preset's own setup by jest's preset merge.
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Framework-dependent hooks (afterEach) must go here, not in setupFiles.
  setupFilesAfterEnv: ['<rootDir>/jest.afterEnv.js'],
};
