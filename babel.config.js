module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // reanimated v4 worklets — must stay the last plugin
  plugins: ['react-native-worklets/plugin'],
};
