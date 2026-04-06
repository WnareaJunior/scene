# OpenCrib

Location-based event discovery platform connecting micro-venue hosts and independent artists with local audiences. Map-driven, RSVP-enforced, social-graph-aware.

## What it does

- **Map-first discovery** — Browse live event pins on an interactive dark-mode map. Pins update as you pan and zoom.
- **Event creation** — Host events with capacity limits, hashtag categories, privacy controls, and attendee list visibility.
- **RSVP system** — Mark yourself as Going or Interested. Capacity is enforced server-side on Going RSVPs.
- **Social graph** — Follow users, see events from people you follow in your feed, view follower/following lists.
- **Surprise me** — Random event picker respects hashtag filters and capacity state.
- **Auth** — JWT access + refresh token flow with server-side revocation on logout.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React Native (Expo) |
| Backend | Node.js + Express |
| Database | PostgreSQL + PostGIS |
| Auth | JWT (access + refresh tokens) |
| Geo | PostGIS `ST_Within` (bbox) · `ST_DWithin` (radius) |

## Monorepo structure

```
.
├── backend/                  Node.js/Express API
│   ├── src/
│   │   ├── app.js
│   │   ├── db.js
│   │   ├── middleware/
│   │   │   └── auth.js
│   │   └── routes/
│   │       ├── auth.js
│   │       ├── events.js     (includes RSVPs)
│   │       ├── map.js
│   │       └── users.js
│   ├── migrations/
│   │   └── 001_init.sql
│   ├── index.js
│   └── .env.example
└── frontend/
    └── scene/                Expo app
        ├── src/
        │   └── api.js        typed API client
        ├── App.js            auth gate + session bootstrap
        ├── AuthScreen.jsx    login / register
        └── Scene.jsx         map, bottom sheet, event creation, profile
```

## Quick start

See [`backend/README.md`](./backend/README.md) and [`frontend/scene/README.md`](./frontend/scene/README.md) for full setup instructions.

## License

GNU Affero General Public License v3.0 — see [LICENSE](./LICENSE).
This project is closed-source. For inquiries, contact [wilsondev27@outlook.com].
