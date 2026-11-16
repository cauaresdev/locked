// Expo's default Metro config plus Sentry's debug ids, which tie crash stack traces to the
// uploaded source maps. Without a DSN or upload credentials it behaves like the default config.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
