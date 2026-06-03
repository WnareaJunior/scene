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

Open `src/api.js` and update `BASE_URL` to match where your backend is running:

```js
// Local simulator (iOS)
const BASE_URL = 'http://localhost:3000/api/v1';

// Physical device or Android emulator
const BASE_URL = 'http://192.168.x.x:3000/api/v1';  // your machine's LAN IP
```

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
