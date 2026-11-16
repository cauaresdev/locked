// Extends app.json. Release builds on Android block plain-HTTP traffic; allow it
// only when the API itself is plain HTTP (a dev server on the LAN). An https://
// production API keeps cleartext disabled.
module.exports = ({ config }) => {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';
  const cleartext = apiUrl.startsWith('http://');
  const plugins = (config.plugins ?? []).map((p) => {
    if (Array.isArray(p) && p[0] === 'expo-build-properties') {
      return [p[0], { ...p[1], android: { ...p[1]?.android, usesCleartextTraffic: cleartext } }];
    }
    return p;
  });
  // Sentry's plugin uploads source maps at build time and fails the build without credentials:
  // added only when the build sets SENTRY_ORG, SENTRY_PROJECT (and SENTRY_AUTH_TOKEN as an EAS secret).
  if (process.env.SENTRY_ORG && process.env.SENTRY_PROJECT) {
    plugins.push(['@sentry/react-native', {
      organization: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
    }]);
  }
  return { ...config, plugins };
};
