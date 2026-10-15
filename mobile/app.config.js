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
  return { ...config, plugins };
};
