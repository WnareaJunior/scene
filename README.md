# Scene

Location-based event discovery platform connecting micro-venue hosts and independent artists with local audiences. Map-driven, RSVP-enforced, social-graph-aware.

## What it does

- **Map-first discovery** — Browse live event pins on an interactive dark-mode map centered on your GPS location. Pins update as you pan and zoom.
- **Event creation** — Host events with capacity limits, hashtag categories, privacy controls, attendee list visibility, and a cover image.
- **RSVP system** — Single-tap RSVP (Going). Capacity is enforced server-side.
- **Social graph** — Follow users, see events from people you follow in your feed, view follower/following lists.
- **User search** — Find people by username or display name with trigram-powered fuzzy search.
- **Surprise me** — Random event picker respects hashtag filters and capacity state.
- **Image uploads** — Event cover photos and profile avatars stored in Supabase Storage.
- **Auth** — JWT access + refresh token flow with server-side revocation on logout.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React Native (Expo) |
| Backend | Node.js + Express (deployed on Render) |
| Database | PostgreSQL + PostGIS |
| Auth | JWT (access + refresh tokens) |
| Geo | PostGIS `ST_Within` (bbox) · `ST_DWithin` (radius) |
| Storage | Supabase Storage in prod · MinIO (S3 driver) for local dev — `backend/src/storage.js` |
| Search | PostgreSQL `pg_trgm` (username / display name) |

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
│   │       ├── events.js     CRUD + RSVPs + feed + random + image upload
│   │       ├── map.js        Viewport pins
│   │       └── users.js      Profile + social graph + avatar + search
│   ├── migrations/
│   │   ├── 001_init.sql      Base schema (PostGIS, uuid-ossp, indexes)
│   │   ├── 002_refresh_token_varchar.sql
│   │   ├── 003_user_search.sql   display_name + pg_trgm indexes
│   │   └── 004_event_image.sql   image_url column
│   ├── index.js
│   └── .env.example
└── frontend/                 Expo app
    ├── src/
    │   ├── api.js            typed API client
    │   ├── screens/
    │   │   ├── MapScreen.jsx     map + pins + bottom sheet
    │   │   ├── CreateScreen.jsx  event creation form + image picker
    │   │   └── ProfileScreen.jsx profile + hosted events + RSVPs
    │   └── components/
    │       ├── EventCard.jsx
    │       └── SearchSheet.jsx
    ├── App.js                auth gate + session bootstrap
    └── AuthScreen.jsx        login / register
```

## Quick start

See [`backend/README.md`](./backend/README.md) and [`frontend/README.md`](./frontend/README.md) for full setup instructions.

Local development needs no cloud accounts: the devbox home server provides
the Postgres (PostGIS + pgvector, migrations pre-applied) and an S3-compatible
MinIO for image uploads — see "Local: everything on the devbox" in the backend
README.

## License

GNU Affero General Public License v3.0 — see [LICENSE](./LICENSE).
This project is closed-source. For inquiries, contact [wilsondev27@outlook.com].
