// app.config.js — dynamic Expo config.
// Sensitive API keys are read from environment variables so they are never
// committed to source control.  Set them in a .env file (gitignored) or in
// your CI / EAS Secrets dashboard.
//
// Required env vars (EXPO_PUBLIC_ prefix is required for Expo to inline them):
//   EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS     — key restricted to the iOS bundle identifier
//   EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID — key restricted to the Android package name

const iosKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS;
const androidKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID;

if (!iosKey || !androidKey) {
  console.warn(
    '[app.config.js] EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS and/or EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID are not set. ' +
      'Map rendering and Places autocomplete will not work. ' +
      'Copy .env.example to .env and fill in your keys.',
  );
}

module.exports = {
  expo: {
    owner: "wnareajunior",
    name: 'Scene',
    slug: 'scene',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    // OTA update configuration via expo-updates.
    // EXPO_PUBLIC_UPDATE_URL is set in EAS Secrets / CI; leave blank for local dev.
    updates: {
      enabled: !!process.env.EXPO_PUBLIC_UPDATE_URL,
      fallbackToCacheTimeout: 0,
      ...(process.env.EXPO_PUBLIC_UPDATE_URL ? { url: process.env.EXPO_PUBLIC_UPDATE_URL } : {}),
    },
    // Only set runtimeVersion when OTA updates are active — expo-updates crashes
    // at launch if runtimeVersion is present without a valid updates.url.
    ...(process.env.EXPO_PUBLIC_UPDATE_URL
      ? { runtimeVersion: { policy: 'appVersion' } }
      : {}),
    splash: {
      image: './assets/splash.png',
      resizeMode: 'contain',
      // Pure black to match the padded background baked into splash.png —
      // any other value would show a visible seam around the image.
      backgroundColor: '#000000',
    },
    ios: {
      supportsTablet: false,
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          'Scene uses your location to show nearby events.',
        NSPhotoLibraryUsageDescription:
          'Scene accesses your photo library so you can set a profile picture.',
        NSPhotoLibraryAddUsageDescription:
          'Scene saves photos to your library.',
      },
      bundleIdentifier: 'com.scene.app',
      config: {
        googleMapsApiKey: iosKey,
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#000000',
      },
      // ACCESS_BACKGROUND_LOCATION is intentionally excluded — requesting it
      // requires Play Store approval and a compelling use-case justification that
      // Scene does not have.  Foreground-only location is sufficient.
      permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'],
      package: 'com.scene.app',
      config: {
        googleMaps: {
          apiKey: androidKey,
        },
      },
    },
    web: {
      favicon: './assets/favicon.png',
    },
    // Keys exposed to JS runtime via Constants.expoConfig.extra
    // (platform-specific config blocks above are native-only and not readable at runtime)
    extra: {
      googleMapsApiKeyIos: iosKey,
      googleMapsApiKeyAndroid: androidKey,
      eas: {
      projectId: "36db5545-5a17-42d4-a9ea-cb8fe9b75178",
    },
    },
  },
};
