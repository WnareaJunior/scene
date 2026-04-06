# OpenCrib — Backend

Node.js + Express REST API. Serves `http://localhost:3000/api/v1`.

## Requirements

- Node.js 18+
- PostgreSQL 14+ with PostGIS extension
- npm

## Setup

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env`:

```env
DATABASE_URL=postgres://user:password@localhost:5432/opencrib_dev
JWT_SECRET=a_long_random_secret
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
PORT=3000
```

### Database

```bash
createdb opencrib_dev
psql opencrib_dev < migrations/001_init.sql
```

The migration enables `uuid-ossp` and `postgis`, creates all tables, and adds spatial + time indexes.

### Run

```bash
npm run dev     # nodemon — auto-restarts on changes
npm start       # production
```

---

## API reference

Base URL: `http://localhost:3000/api/v1`

All routes except `/auth/register`, `/auth/login`, and `/auth/refresh` require:
```
Authorization: Bearer <accessToken>
```

---

### Auth

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/auth/register` | `{ email, password, username }` | Create account — returns tokens + user |
| POST | `/auth/login` | `{ email, password }` | Login — returns tokens + user |
| POST | `/auth/refresh` | `{ refreshToken }` | Get new access token |
| POST | `/auth/logout` | `{ refreshToken }` | Revoke refresh token |

---

### Users

| Method | Path | Description |
|---|---|---|
| GET | `/users/me` | Own profile |
| PATCH | `/users/me` | Update bio, gender, interests, profilePicture |
| GET | `/users/me/hosted-events` | Events you're hosting (`?status=upcoming\|past`) |
| GET | `/users/me/rsvps` | Your RSVPs (`?status=going\|interested`) |
| GET | `/users/:userId` | Public profile |
| POST | `/users/:userId/follow` | Follow a user |
| DELETE | `/users/:userId/follow` | Unfollow |
| GET | `/users/:userId/followers` | Follower list |
| GET | `/users/:userId/following` | Following list |

---

### Events

| Method | Path | Description |
|---|---|---|
| POST | `/events` | Create event |
| GET | `/events` | Discover — bbox or radius + hashtag/time filters |
| GET | `/events/feed` | Events from people you follow |
| GET | `/events/random` | One random nearby event |
| GET | `/events/:eventId` | Full event detail |
| PATCH | `/events/:eventId` | Update event (host only) |
| DELETE | `/events/:eventId` | Cancel event (host only) |

**Discover query params:**

| Param | Description |
|---|---|
| `swLat`, `swLng`, `neLat`, `neLng` | Bounding box (preferred for map viewport) |
| `lat`, `lng`, `radius` | Radius mode (meters, default 5000) |
| `hashtags` | Comma-separated, e.g. `punk,diy` |
| `startAfter`, `startBefore` | ISO 8601 datetime filters |
| `page`, `limit` | Pagination (max 100) |

---

### RSVPs

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/events/:eventId/rsvp` | `{ status }` | RSVP — `going` enforces capacity |
| PATCH | `/events/:eventId/rsvp` | `{ status }` | Change RSVP status |
| DELETE | `/events/:eventId/rsvp` | — | Cancel RSVP |
| GET | `/events/:eventId/attendees` | — | Attendee list (if host allows) |

---

### Map

| Method | Path | Description |
|---|---|---|
| GET | `/map/events` | Lightweight event pins for the visible viewport |

**Required params:** `swLat`, `swLng`, `neLat`, `neLng`
**Optional:** `hashtags`

Returns minimal `EventPin` objects (id, lat, lng, title, hashtags, goingCount, startTime) — not full event detail. Tap a pin → `GET /events/:id`.

---

## Project structure

```
backend/
├── index.js              Entry point (starts server)
├── src/
│   ├── app.js            Express app, middleware, route mounting
│   ├── db.js             pg Pool wrapper
│   ├── middleware/
│   │   └── auth.js       JWT Bearer verification
│   └── routes/
│       ├── auth.js
│       ├── events.js     CRUD + RSVPs + feed + random
│       ├── map.js        Viewport pins
│       └── users.js      Profile + social graph
├── migrations/
│   └── 001_init.sql      Schema (PostGIS, uuid-ossp, indexes)
└── .env.example
```

## Geo implementation notes

- **Bbox query** (map pins, discover): `ST_Within(location::geometry, ST_MakeEnvelope(swLng, swLat, neLng, neLat, 4326))`
- **Radius query** (discover, random): `ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography, radius_meters)`
- The `location` column is `GEOGRAPHY(POINT, 4326)`. `latitude` and `longitude` float columns are stored redundantly for cheap reads without PostGIS unpacking.
- A GIST index on `location` keeps geo queries fast.
