// app.config.js — dynamic Expo config.
// Sensitive API keys are read from environment variables so they are never
// committed to source control.  Set them in a .env file (gitignored) or in
// your CI / EAS Secrets dashboard.
//
// Required env vars:
//   GOOGLE_MAPS_API_KEY_IOS     — key restricted to the iOS bundle identifier
//   GOOGLE_MAPS_API_KEY_ANDROID — key restricted to the Android package name

const iosKey = process.env.GOOGLE_MAPS_API_KEY_IOS;
const androidKey = process.env.GOOGLE_MAPS_API_KEY_ANDROID;

if (!iosKey || !androidKey) {
  console.warn(
    '[app.config.js] GOOGLE_MAPS_API_KEY_IOS and/or GOOGLE_MAPS_API_KEY_ANDROID are not set. ' +
      'Map rendering and Places autocomplete will not work. ' +
      'Copy .env.example to .env and fill in your keys.',
  );
}

module.exports = {
  expo: {
    name: 'Scene',
    slug: 'scene',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    // OTA update configuration via expo-updates.
    // EXPO_PUBLIC_UPDATE_URL is set in EAS Secrets / CI; leave blank for local dev.
    updates: {
      enabled: true,
      fallbackToCacheTimeout: 0,
      url: process.env.EXPO_PUBLIC_UPDATE_URL || '',
    },
    // Runtime version policy: bump automatically whenever the native app version
    // (version field above) changes, preventing stale OTA bundles from running on
    // incompatible native code.
    runtimeVersion: {
      policy: 'appVersion',
    },
    splash: {
      image: './assets/splash.png',
      resizeMode: 'contain',
      backgroundColor: '#0a0a0a',
    },
    ios: {
      supportsTablet: false,
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          'Scene uses your location to show nearby events.',
      },
      bundleIdentifier: 'ios.scene',
      config: {
        googleMapsApiKey: iosKey,
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#0a0a0a',
      },
      // ACCESS_BACKGROUND_LOCATION is intentionally excluded — requesting it
      // requires Play Store approval and a compelling use-case justification that
      // Scene does not have.  Foreground-only location is sufficient.
      permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'],
      package: 'android.scene',
      config: {
        googleMaps: {
          apiKey: androidKey,
        },
      },
    },
    web: {
      favicon: './assets/favicon.png',
    },
  },
};
