module.exports = {
  root: true,
  extends: '@react-native',
  // @react-native's `env` predates the web globals RN 0.83 actually ships on
  // Hermes, so `npm run lint` failed on a clean tree at
  // __tests__/auth.test.js:45 — a real global asserted against, reported as
  // no-undef. Declared rather than disabled inline: the assertion is the point
  // of that test (every authed call must carry an abort signal).
  globals: {
    AbortController: 'readonly',
    AbortSignal: 'readonly',
  },
  overrides: [
    {
      // @react-native's jest override only matches .js/.ts/.tsx test files — add .jsx.
      files: ['**/__tests__/**/*.jsx', '**/*.{spec,test}.jsx'],
      env: { jest: true },
    },
  ],
};
