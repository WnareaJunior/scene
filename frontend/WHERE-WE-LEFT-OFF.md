# Where We Left Off — iOS v1 Build (2026-07-18)

## Milestone reached
First iOS EAS build **succeeded** and is installed on Wilson's iPhone
(ad-hoc internal distribution, no TestFlight yet). Backend/DB on Render
were being woken from pause for on-device testing.

## Current state

- **Branch**: `fix/eas-v1-blockers` — PR #32 open against `main`
  (https://github.com/WnareaJunior/scene/pull/32). Merge once on-device
  testing looks good.
- **Expo SDK**: 57.0.7 (upgraded from 50) · React Native 0.86.0 · React 19.2.3
  - New Architecture **enabled** (default; required by Reanimated 4)
  - Babel plugin is `react-native-worklets/plugin` (Reanimated 4 change)
  - `expo-doctor`: 20/20 checks pass
- **Config**: `app.config.js` is the single source of truth (stale `app.json`
  deleted). `frontend/ios` + `frontend/android` are gitignored → CNG/managed
  workflow; EAS prebuilds from config.
- **Bundle ID**: `com.wilsonnarea.scene` (iOS + Android package).
  `com.scene.app` was taken globally on Apple's registry. Treat the new ID
  as FINAL once anything ships to TestFlight.
- **Apple**: Individual team W96B85P6DV. EAS manages the distribution cert
  and ad-hoc provisioning profile (both expire 2027-07-18). One iPhone
  registered (UDID 00008130-00015C1C2638001C).
- **Expo account**: project lives under `wnareajunior` (owner in
  app.config.js). Log in as that account for all `eas` commands — the
  `wnarea` account has no access.
- **Assets**: real "S" branding wired into `assets/icon.png`, `splash.png`
  (2048x2048, icon padded on pure black), `adaptive-icon.png`, `favicon.png`.
  Splash/adaptive background color in config is `#000000` to match the art.
- **Env vars**: `.env.example` and `app.config.js` agree on
  `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS` / `_ANDROID`. Local `.env` has real
  values. The successful build got keys via the uploaded `.env`, but
  `.easignore` now excludes `.env` from uploads (commit 8d151db) — so
  TODO 2 is REQUIRED before the next build or maps will be keyless.
- **API**: `src/api.js` hardcodes `https://scene-19ss.onrender.com/api/v1`.
  Render free tier: expect 30–60 s cold starts after idle.
- **`.easignore`** added — first upload was 176 MB (stale local native dirs);
  next builds upload ~1 MB.

## TODO — next session

1. **Finish on-device testing** (login, map tiles, Places autocomplete,
   event feed) and **merge PR #32**.
2. **Move Maps keys into EAS env vars** — REQUIRED before the next build:
   `.env` no longer uploads, so without these the next build ships without
   Maps keys (run per environment: `preview`, `production`):
   ```
   eas env:create --scope project --name EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS \
     --value <ios-key> --environment production --visibility plaintext
   ```
3. **Google Maps key hygiene**: currently ONE unrestricted-looking key used
   for iOS/Android/geocoding. Create separate keys, restrict the iOS one to
   bundle ID `com.wilsonnarea.scene`, and rotate the existing key (it has
   been sitting unrestricted in a shipped bundle).
4. **Cleanup**: delete unused `assets/icon-*.png` size matrix (Expo generates
   all sizes from the single 1024px icon) and the stale local `frontend/ios`
   / `frontend/android` dirs (`rm -rf`, they regenerate).
5. **TestFlight path** when ready for wider testing:
   `eas build --platform ios --profile production` → `eas submit -p ios`.
   Ad-hoc preview builds only install on UDIDs registered at build time
   (`eas device:create` to add more, then rebuild).
6. **Android build** — untested this session (iOS-only focus). Known watch
   item: launcher masks may slightly clip the "S" corners (glyph extends a
   bit past the adaptive-icon safe zone).

## Gotchas learned (don't relearn these)

- `eas build --profile preview.` ← trailing punctuation becomes part of the
  profile name.
- EAS caches Apple ID sessions in `~/.app-store`; `rm -rf ~/.app-store` or
  `EXPO_APPLE_ID=<email>` to switch accounts.
- Browser-based `eas login` grabs whatever expo.dev session the browser has —
  check `eas whoami` before building.
- Bundle IDs are globally unique across ALL Apple accounts, not per-team.
