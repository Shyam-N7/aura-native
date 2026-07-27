const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withSentryConfig } = require('@sentry/react-native/metro');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {};

// withSentryConfig stamps a debugId into the bundle + source map, so field
// crash stacks match their map deterministically (release-name matching is
// the fallback and misfires across dists). No effect on dev serving.
module.exports = withSentryConfig(
  mergeConfig(getDefaultConfig(__dirname), config),
);
