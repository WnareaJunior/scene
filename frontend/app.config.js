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

// ── Party invite links ──────────────────────────────────────────────────────
// A link is https://<share host>/e/<token>. For a tap on it to open Scene
// instead of Safari/Chrome, the host has to be compiled into the binary
// (iOS associated domains, Android intent filters). That means changing the
// host needs a new EAS build; an OTA update cannot do it.
//
// THE ONE SWITCH: EXPO_PUBLIC_SHARE_HOST here and SHARE_BASE_URL on the API
// must name the same host (SHARE_BASE_URL=https://<EXPO_PUBLIC_SHARE_HOST>).
// Unset, both fall back to the API's own host, so links work before a custom
// domain exists. See backend/README.md → "Invite links: domain day".
//
// The API host stays in the list even after a custom domain is set, so links
// already sent on the Render host keep opening the app.
const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'https://scene-19ss.onrender.com';
const apiHost = hostOf(apiUrl);
const shareHost = (process.env.EXPO_PUBLIC_SHARE_HOST || apiHost || '').trim().toLowerCase();

function hostOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

// Universal links / app links need a real https hostname: not an IP, not
// localhost, no scheme or path. The development profile (http://100.x) gets
// none and relies on the scene:// scheme.
const isLinkableHost = (h) =>
  !!h && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) && !/^\d+(\.\d+){3}$/.test(h);

if (process.env.EXPO_PUBLIC_SHARE_HOST && !isLinkableHost(shareHost)) {
  throw new Error(
    `[app.config.js] EXPO_PUBLIC_SHARE_HOST="${process.env.EXPO_PUBLIC_SHARE_HOST}" must be a bare ` +
      'hostname like scene.party (no https://, no path).',
  );
}
if (process.env.EXPO_PUBLIC_SHARE_HOST && shareHost !== apiHost) {
  console.warn(
    `[app.config.js] invite links: this build opens https://${shareHost}/e/… (and ${apiHost || 'no API host'}). ` +
      `The API must have SHARE_BASE_URL=https://${shareHost}, and ${shareHost} must be a custom domain ` +
      'on the same Render service, or shared links will not open the app.',
  );
}

const linkHosts = [...new Set([shareHost, apiHost])].filter(isLinkableHost);

module.exports = {
  expo: {
    owner: "wnareajunior",
    name: 'Scene',
    slug: 'scene',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    // scene://e/<token> — the invite page's "open in scene" button. Works on
    // any build with this scheme, with or without associated domains.
    scheme: 'scene',
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
        // Standard HTTPS only — exempt from export-compliance review. Without
        // this, every TestFlight build stalls on "Missing Compliance" until the
        // encryption questionnaire is answered by hand in App Store Connect.
        ITSAppUsesNonExemptEncryption: false,
        NSLocationWhenInUseUsageDescription:
          'Scene uses your location to show nearby events.',
        NSPhotoLibraryUsageDescription:
          'Scene accesses your photo library so you can set a profile picture.',
        NSPhotoLibraryAddUsageDescription:
          'Scene saves photos to your library.',
      },
      // NOTE: com.scene.app is taken globally on Apple's registry — bundle IDs
      // are unique across all Apple developer accounts.
      bundleIdentifier: 'com.wilsonnarea.scene',
      // Universal links. iOS fetches each host's
      // /.well-known/apple-app-site-association (served by the API once
      // APPLE_TEAM_ID is set) through Apple's CDN at install time.
      associatedDomains: linkHosts.map((h) => `applinks:${h}`),
      // No ios.config.googleMapsApiKey here: it makes prebuild link the
      // react-native-google-maps pod, which react-native-maps no longer ships
      // (pod install fails). iOS renders Apple Maps — no provider prop is set —
      // and the JS Places/Geocoding calls read the key from process.env.
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
      package: 'com.wilsonnarea.scene',
      // App links. autoVerify makes Android check each host's
      // /.well-known/assetlinks.json (served by the API once
      // ANDROID_CERT_SHA256 is set); unverified, the link opens the browser.
      intentFilters: linkHosts.length
        ? [
            {
              action: 'VIEW',
              autoVerify: true,
              data: linkHosts.map((host) => ({ scheme: 'https', host, pathPrefix: '/e/' })),
              category: ['BROWSABLE', 'DEFAULT'],
            },
          ]
        : [],
      config: {
        googleMaps: {
          apiKey: androidKey,
        },
      },
    },
    web: {
      favicon: './assets/favicon.png',
    },
    // Subpath hosting (GitHub Pages project sites live at /<repo>/): prefixes
    // every asset URL in the web export. urlSync.web.js strips/re-adds the
    // same prefix for routing. Unset for local dev, CI e2e, and root hosting.
    ...(process.env.EXPO_PUBLIC_WEB_BASE_PATH
      ? { experiments: { baseUrl: process.env.EXPO_PUBLIC_WEB_BASE_PATH } }
      : {}),
    // Keys exposed to JS runtime via Constants.expoConfig.extra
    // (platform-specific config blocks above are native-only and not readable at runtime)
    extra: {
      googleMapsApiKeyIos: iosKey,
      googleMapsApiKeyAndroid: androidKey,
      // What this binary was built to open; src/inviteLink.js warns when the
      // API hands back a link on any other host.
      shareHost,
      linkHosts,
      eas: {
      projectId: "36db5545-5a17-42d4-a9ea-cb8fe9b75178",
    },
    },
  },
};
