# Where We Left Off — Device Testing + TestFlight + Design System (2026-07-19)

## Milestone reached
On-device testing round-trip complete (2 fix rounds), **TestFlight external
testing is live pending Apple beta review**, and the design system was
captured and re-anchored (Sodium Amber, "The Unlisted Map").

## Current state

- **Branch**: everything merged to `main` (PRs #33–#42). Working tree clean.
- **TestFlight**: app record "Scene (fcda77)" (Apple ID 6792423931, bundle
  `com.wilsonnarea.scene`). External group **Colleagues** (limit 50) with
  public link **https://testflight.apple.com/join/WG6cdp1k** — testers can
  join once Beta App Review approves (submitted 2026-07-19, usually <24 h).
  Review demo account: `applereview@scenedemo.app` / `SceneBeta2026!`
  (throwaway user on the prod DB).
- **Builds**: build 4 (1.0.0) submitted for beta review. Two newer builds
  (preview + production) fired at session end with everything below — when
  the production one processes, ADD IT TO THE COLLEAGUES GROUP in
  App Store Connect → TestFlight so testers start on the amber build.
- **Design context**: `PRODUCT.md` + `DESIGN.md` + `.impeccable/design.json`
  at repo root. North Star "The Unlisted Map"; accent is now
  **Sodium Amber #ffa028** (pressed #e08010, tint #2b1d0a, text-on-amber
  #1a0d00). The old purple #a855f7 is banned (No-Purple Rule).
- **EAS**: uploads are ~1 MB now (root `.easignore`; the 176 MB culprit was
  the repo-root `.venv`). iOS production credentials validated interactively
  — production builds now work with `--non-interactive`.
- **Render**: CLI authed, workspace "My Workspace", service
  `srv-d7fbu7c71suc738l4g1g`, auto-deploys on push to `main`.

## Fixed this session

1. Cold-start "network connection was lost" on signup → fetch retry in api.js.
2. "Unsupported FormDataPart" on image upload → expo-file-system `File`
   (SDK 54+ WinterCG fetch rejects RN `{uri}` parts).
3. Event sheet: clipped hero, buried ✕, no swipe-down → fixed + pan-to-dismiss.
4. Address autocomplete dead-ends → geocode fallback + visible error alerts.
5. Profile party images missing → backend SELECTs lacked `image_url`.
6. Sheet drag snapping → translateY transform (was layout-prop `top`).
7. "Rigid" gesture feel → velocity-fed springs + rubber-band overdrag.
8. Five UI fixes (keyboard dismiss, smaller create-map, Start Time Done
   button, chip map markers, pull-to-refresh).
9. Full UX copy rewrite (lowercase flyer voice, actionable errors,
   teaching empty states, "party" terminology).
10. Sodium Amber migration across all 9 UI files.

## TODO — next session

1. **Add the new production build to the Colleagues TestFlight group**
   (App Store Connect → TestFlight → Colleagues → Builds) once processed;
   share the public link with colleagues after beta review approves.
2. **Verify on device**: amber theme, gesture feel (velocity springs),
   new copy, pull-to-refresh, chip markers, Start Time Done flow.
3. **Google Maps key hygiene** (still open from last session): split the
   single unrestricted key, restrict per-platform, rotate the old one.
4. **Extract color tokens** to `src/constants/colors.js`
   (`/impeccable extract`) — hexes are still hardcoded per-file.
5. **EventDetailSheet drag** still runs on the JS thread (PanResponder);
   convert to RNGH/Reanimated (needs in-Modal GestureHandlerRootView +
   scroll arbitration).
6. Backend nits: no request logging in prod; runs under nodemon (switch
   start script to `node index.js`).
7. Accessibility pass deferred by decision — revisit after colleague
   feedback (contrast of #555-on-dark, VoiceOver labels, Reduce Motion).

## Gotchas learned (don't relearn these)

- EAS archives from the **git repo root**; `.easignore` only counts there.
- Expo SDK 54+ global fetch is WinterCG: RN `{uri}` FormData parts throw.
- `ios.config.googleMapsApiKey` breaks pod install (react-native-maps 1.27
  has no `react-native-google-maps` podspec) — Apple Maps needs no key.
- Reanimated springs feel "rigid" without `velocity:` from the gesture.
- Render cold start can drop the first request at the proxy (iOS -1005).
- ASC "My Workspace" quirk: `render workspace set <id>` non-interactive;
  the `!` session shell has no TTY for interactive pickers.
