# OpenCrib — Frontend

React Native (Expo) app. Dark-mode, map-first event discovery.

## Requirements

- Node.js 18+
- Expo CLI (`npm install -g expo-cli`)
- iOS Simulator / Android Emulator, or Expo Go on a physical device

## Setup

```bash
cd frontend/scene
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
frontend/scene/
├── App.js              Auth gate — bootstraps session, renders AuthScreen or Scene
├── AuthScreen.jsx      Login / register screen
├── Scene.jsx           Main app: map, bottom sheet, event creation, profile
├── src/
│   └── api.js          Typed API client (all backend calls go through here)
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

- Renders live event pins from `GET /map/events` — updates on every pan/zoom via `onRegionChangeComplete`.
- Tap a pin to see event detail and RSVP.

### Bottom sheet

- Draggable sheet with three snap positions (peek, half, full).
- Fetches events from `GET /events` using the current map viewport bbox.
- Category pills filter by hashtag.
- Each event card has Going and Interested RSVP buttons.

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

Tokens are stored in `@react-native-async-storage/async-storage`.

---

## Dependencies

| Package | Purpose |
|---|---|
| `expo` | Build toolchain |
| `react-native-maps` | MapView + Marker |
| `react-native-gesture-handler` | Pan gestures for swipe nav + bottom sheet |
| `react-native-reanimated` | Spring animations |
| `react-native-safe-area-context` | Notch/inset handling |
| `@react-native-async-storage/async-storage` | Token persistence |
