module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      // @react-native's jest override only matches .js/.ts/.tsx test files — add .jsx.
      files: ['**/__tests__/**/*.jsx', '**/*.{spec,test}.jsx'],
      env: { jest: true },
    },
  ],
};
