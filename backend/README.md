# Scene — Backend

Node.js + Express REST API. Serves `http://localhost:3000/api/v1` locally and `https://scene-19ss.onrender.com/api/v1` in production.

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
DATABASE_URL=postgres://user:password@localhost:5432/scene_dev
JWT_ACCESS_SECRET=a_long_random_secret
JWT_REFRESH_SECRET=another_long_random_secret
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
PORT=3000
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_KEY=<service_role_key>
SUPABASE_BUCKET=scene-images
SEARCH_ENABLED=true   # /api/v1/search is 404 unless this is set
```

### Environments — staging vs production

There are two Supabase projects. **`.env` points at staging and is what
every local run uses by default. Production credentials live only in
`.env.production` (gitignored) and must never be the ambient default** —
touching prod should always be a deliberate act:

```bash
# run something against production, explicitly:
env $(grep -v '^#' .env.production | xargs) node src/search/worker/embed-events.js --once
```

| | project ref | used by |
|---|---|---|
| staging | `rpjnkjoyxeykqlppwfkp` (scene-staging) | local dev, tests, destructive experiments |
| production | `kxtrlrtuanjcchwwfqvj` (scene) | Render deploy + the released app — via Render env vars, not a local file |

Staging gotchas: connect via the direct host (`db.<ref>.supabase.co`) —
the pooler works too once the tenant registers. JWT secrets differ from
prod on purpose (a leaked dev token can't be replayed against prod).
`AWS_*` upload keys are still the prod bucket's; create staging-scoped
keys if upload testing matters.

### Database

```bash
createdb scene_dev
psql scene_dev < migrations/001_init.sql
psql scene_dev < migrations/002_refresh_token_varchar.sql
psql scene_dev < migrations/003_user_search.sql
psql scene_dev < migrations/004_event_image.sql
psql scene_dev < migrations/005_reports_blocks.sql
psql scene_dev < migrations/seed_nyc.sql          # optional: NYC test data
psql scene_dev < src/search/sql/001_search_schema.sql
psql scene_dev < src/search/sql/002_seed_neighborhoods.sql
# src/search/sql/003_hnsw_index.sql runs only after the embedding backfill
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
| PATCH | `/users/me` | Update bio, display_name, gender, interests, profilePicture |
| POST | `/users/me/avatar` | Upload profile avatar (multipart/form-data `avatar`) |
| GET | `/users/me/hosted-events` | Events you're hosting (`?status=upcoming\|past`) |
| GET | `/users/me/rsvps` | Your RSVPs (`?status=going\|interested`) |
| GET | `/users/search` | Search users by username or display_name (`?q=&limit=&offset=`) |
| GET | `/users/:userId` | Public profile |
| POST | `/users/:userId/follow` | Follow a user |
| DELETE | `/users/:userId/follow` | Unfollow |
| GET | `/users/:userId/followers` | Follower list |
| GET | `/users/:userId/following` | Following list |

---

### Events

| Method | Path | Description |
|---|---|---|
| POST | `/events/image` | Upload event cover image → returns `imageUrl` (multipart/form-data `image`) |
| POST | `/events` | Create event (pass `imageUrl` from prior upload) |
| GET | `/events` | Discover — bbox or radius + hashtag/time filters |
| GET | `/events/feed` | Events from people you follow |
| GET | `/events/random` | One random nearby event |
| GET | `/events/:eventId` | Full event detail |
| PATCH | `/events/:eventId` | Update event (host only) |
| DELETE | `/events/:eventId` | Cancel event (host only) |

Image upload accepts JPEG, PNG, and WebP. Magic-byte validation is performed server-side. Files are stored in Supabase Storage and the public URL is returned for use in the create/update body.

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
│       ├── events.js     CRUD + RSVPs + feed + random + image upload
│       ├── map.js        Viewport pins
│       └── users.js      Profile + social graph + avatar + search
├── migrations/
│   ├── 001_init.sql              Base schema (PostGIS, uuid-ossp, indexes)
│   ├── 002_refresh_token_varchar.sql
│   ├── 003_user_search.sql       display_name + pg_trgm trigram indexes
│   └── 004_event_image.sql       image_url column on events
└── .env.example
```

## Geo implementation notes

- **Bbox query** (map pins, discover): `ST_Within(location::geometry, ST_MakeEnvelope(swLng, swLat, neLng, neLat, 4326))`
- **Radius query** (discover, random): `ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography, radius_meters)`
- The `location` column is `GEOGRAPHY(POINT, 4326)`. `latitude` and `longitude` float columns are stored redundantly for cheap reads without PostGIS unpacking.
- A GIST index on `location` keeps geo queries fast.

## Image storage notes

- Images are uploaded via `POST /events/image` or `POST /users/me/avatar` as `multipart/form-data`.
- Server validates MIME type from magic bytes (not the `Content-Type` header) before accepting the file.
- Files are stored in a Supabase Storage bucket (`SUPABASE_BUCKET` env var). The returned public URL is then stored in `events.image_url` or `users.profile_picture`.
- Requires `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in `.env`.

## Search notes

- `GET /users/search?q=` queries both `username` and `display_name` using `ILIKE` backed by GIN trigram indexes (`pg_trgm`).
- Migration `003_user_search.sql` installs the extension and creates the indexes.
