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
};
