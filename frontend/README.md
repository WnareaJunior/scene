# Scene — Frontend

React Native (Expo) app. Dark-mode, map-first event discovery.

## Requirements

- Node.js 18+
- Expo CLI (`npm install -g expo-cli`)
- iOS Simulator / Android Emulator, or Expo Go on a physical device

## Setup

```bash
cd frontend
npm install
```

### Point to your backend

`src/api.js` reads `EXPO_PUBLIC_API_URL` at build time and falls back to the
production API. Set it in `.env` for `expo start`, or rely on the per-profile
value in `eas.json` for EAS builds:

| Profile | `EXPO_PUBLIC_API_URL` | Talks to |
|---|---|---|
| `development` | `http://100.64.203.64:3005` | the devbox stack (`stacks/scene`), phone on Tailscale |
| `preview` | `https://scene-staging-pr6j.onrender.com` | the staging Render service (`staging-api.<domain>` once the domain exists) |
| `production` | `https://scene-19ss.onrender.com` | production |

```bash
# dev server against the devbox
EXPO_PUBLIC_API_URL=http://100.64.203.64:3005 npx expo start

# simulator against a backend on this machine
EXPO_PUBLIC_API_URL=http://localhost:3000 npx expo start
```

Metro does not key its cache on env vars: pass `-c` after changing the URL or
the old value stays baked in.

### Invite links

`app.config.js` registers the `scene://` scheme and claims `https://<host>/e/*`
(iOS associated domains, Android intent filter with `autoVerify`) for:

- `EXPO_PUBLIC_SHARE_HOST`, a bare hostname such as `scene.party`, when set
- the host of `EXPO_PUBLIC_API_URL`, always (so links sent before a custom
  domain keep opening the app)

Unset, links live on the API's Render host. `EXPO_PUBLIC_SHARE_HOST` must match
the API's `SHARE_BASE_URL`, and changing it needs a new EAS build, not an OTA
update. Domain-day steps: `backend/README.md` → "Invite links: domain day".

### Run

```bash
npm start          # Expo dev server — scan QR with Expo Go
npm run ios        # iOS Simulator
npm run android    # Android Emulator
```

---

## App structure

```
frontend/
├── App.js                  Auth gate — bootstraps session, renders AuthScreen or Scene
├── src/
│   ├── AuthScreen.jsx      Login / register screen
│   ├── Scene.jsx           Main app: map, bottom sheet, event creation, profile
│   ├── api.js              Typed API client (all backend calls go through here)
│   ├── screens/            MapScreen, CreateScreen, ProfileScreen
│   ├── components/         SearchSheet, EventCard, EventDetailSheet, UserProfileSheet, …
│   ├── constants/          Shared style/config constants (e.g. dark map style)
│   └── utils/              Shared helpers (e.g. geo/haversine)
└── package.json
```

---

## Screens & navigation

The app uses a swipe-based navigation model — no navigator library.

| Swipe | Screen |
|---|---|
| Center | Map view + bottom sheet |
| Swipe right / tap 👤 | Profile |
| Swipe left / tap ＋ | Create Event |

### Map screen

- Renders live event pins from `GET /map/events` — updates on every pan/zoom via `onRegionChangeComplete` (debounced, with a movement guard).
- Tap a pin to open the event detail sheet (fetches the full event by id) and RSVP. From the detail sheet, tapping the host opens their profile.

### Bottom sheet

- Draggable sheet with snap positions (peek, half, full).
- Fetches events from `GET /events` using the current map viewport bbox.
- Search nearby, or `@username` to find people.
- Each event card has a single RSVP ("Going") button; tapping a card opens the detail sheet.

### Create Event

- Posts to `POST /events` using the map's current center as lat/lng.
- Fields: title, address (display only), date/time, capacity, category hashtag.

### Profile

- Loads `GET /users/me` on mount.
- Shows real follower/following counts and hosted events.
- Sign Out calls `POST /auth/logout` and clears stored tokens.

---

## API client (`src/api.js`)

All network calls go through a single `request()` function that:

1. Attaches the stored `accessToken` as a Bearer header.
2. On 401, automatically refreshes the access token via `POST /auth/refresh`.
3. On refresh failure, clears tokens and throws `'Session expired'` — `App.js` catches this and returns to the auth screen.

Tokens are stored encrypted on-device via `expo-secure-store`.

---

## Dependencies

| Package | Purpose |
|---|---|
| `expo` | Build toolchain |
| `react-native-maps` | MapView + Marker |
| `react-native-gesture-handler` | Pan gestures for swipe nav + bottom sheet |
| `react-native-reanimated` | Spring animations |
| `react-native-safe-area-context` | Notch/inset handling |
| `expo-secure-store` | Encrypted on-device token storage |
| `expo-location` | User location for map centering |
