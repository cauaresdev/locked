// Signs release builds with the app's own upload key instead of the debug key, so every future
// APK installs over the previous one. The key and its passwords never enter the repository: they
// come from Gradle properties (~/.gradle/gradle.properties on the build machine):
//   KINETIC_UPLOAD_STORE_FILE=/absolute/path/kinetic-upload.jks
//   KINETIC_UPLOAD_STORE_PASSWORD=...
//   KINETIC_UPLOAD_KEY_ALIAS=kinetic
//   KINETIC_UPLOAD_KEY_PASSWORD=...
// Without them the release build falls back to the debug key, as before.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = '// withReleaseSigning';

const RELEASE_CONFIG = `
        release { ${MARK}
            if (findProperty('KINETIC_UPLOAD_STORE_FILE')) {
                storeFile file(findProperty('KINETIC_UPLOAD_STORE_FILE'))
                storePassword findProperty('KINETIC_UPLOAD_STORE_PASSWORD')
                keyAlias findProperty('KINETIC_UPLOAD_KEY_ALIAS')
                keyPassword findProperty('KINETIC_UPLOAD_KEY_PASSWORD')
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARK)) return cfg;
    // Add the release signing config next to the debug one.
    gradle = gradle.replace(/(signingConfigs \{\s*\n\s*debug \{[\s\S]*?\n\s*\})/, `$1${RELEASE_CONFIG}`);
    // The release build type uses it when the key is configured.
    gradle = gradle.replace(
      /(release \{\s*\n(?:\s*\/\/.*\n)*\s*)signingConfig signingConfigs\.debug/,
      "$1signingConfig findProperty('KINETIC_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
    );
    if (!gradle.includes(MARK) || !gradle.includes('signingConfigs.release')) {
      throw new Error('withReleaseSigning: app/build.gradle no longer matches the expected template');
    }
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
