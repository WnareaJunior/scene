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

### Local: everything on the devbox (no cloud accounts)

The home server runs a Postgres 17 (PostGIS + pgvector) and a MinIO that
replace Supabase entirely for local dev. The `scene` database is managed by
`scripts/migrate.js` (see "Database" below); the `scene` MinIO bucket allows
anonymous downloads so stored image URLs work from a phone. Point `.env` at
them:

```env
DATABASE_URL=postgresql://dev:<password>@devbox:5433/scene
DATABASE_SSL=disable            # local Postgres has no TLS

STORAGE_DRIVER=s3               # src/storage.js switches drivers
S3_ENDPOINT=http://devbox:9000  # where the API uploads to
S3_PUBLIC_URL=http://<devbox LAN or Tailscale IP>:9000   # what gets stored in image URLs
S3_BUCKET=scene
S3_ACCESS_KEY=devbox
S3_SECRET_KEY=<minio password>
```

`S3_PUBLIC_URL` matters: the URL the API stores in `events.image_url` is what
the phone later fetches, so it must be an address the phone can resolve. Over
Tailscale that is the devbox's tailnet IP; on the LAN its LAN IP. It defaults
to `S3_ENDPOINT` when unset.

Passwords live on the devbox in `~/stacks/data/.env` (`DEV_POSTGRES_PASSWORD`)
and `~/stacks/devtools/.env` (`MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`); both
files are gitignored there. Works from any Tailscale device — the app on your
phone can hit a backend running on the devbox too.

### Environments — local, staging, production

`backend/.env` is the **local** target: the devbox Postgres and MinIO (section
above). It is what every plain `node …` and `npm run …` uses, and it cannot
reach Supabase.

The two Supabase projects are reached only through `scripts/with-env.sh`,
which loads a named file and runs one command with it:

```bash
scripts/with-env.sh staging    node scripts/migrate.js --status
scripts/with-env.sh production node scripts/migrate.js --baseline 0003
scripts/with-env.sh production node src/search/worker/embed-events.js --once
```

| | file | project ref | used by |
|---|---|---|---|
| local | `.env` | devbox `scene` DB | every plain command, the devbox stack, tests (`scene_test`) |
| staging | `.env.staging` | `rpjnkjoyxeykqlppwfkp` (scene-staging) | rehearsals, the staging Render service (via its own env vars) |
| production | `.env.production` | `kxtrlrtuanjcchwwfqvj` (scene) | Render deploy + the released app — via Render env vars, never a local default |

All three files are gitignored. If an older checkout still has `.env` pointing
at staging, rename it to `.env.staging` and rebuild `.env` for the devbox.

Staging gotchas: connect via the direct host (`db.<ref>.supabase.co`) —
the pooler works too once the tenant registers. JWT secrets differ from
prod on purpose (a leaked dev token can't be replayed against prod).
`AWS_*` upload keys are still the prod bucket's; create staging-scoped
keys if upload testing matters.

### Database

Schema lives in `backend/migrations/` as plain SQL files, applied in order by
`scripts/migrate.js`, which records each file in a `schema_migrations` table
(version, checksum, applied time). Migrations are the one `*.sql` path that is
tracked in git; dumps and snapshots stay ignored.

```bash
npm run migrate            # apply every pending migration
npm run migrate:status     # what is applied / pending
node scripts/migrate.js --dry-run
```

| File | What |
|---|---|
| `0001_baseline.sql` | Everything through the old 001–005 migrations plus the search schema, captured 2026-09-15 from the devbox database |
| `0002_seed_neighborhoods.sql` | NYC neighborhood rows for the search parser (idempotent) |
| `0003_hnsw_index.sql` | pgvector HNSW index; runs outside a transaction |

**Fresh database** (CI, a devbox reset): `createdb scene && npm run migrate`.
Needs PostGIS, pgvector, pg_trgm and unaccent available to `CREATE EXTENSION`.

**Existing database** (staging, production, the devbox `scene` DB) already has
the schema, so mark it instead of running it. The runner refuses to apply the
baseline to a database that already has a `users` table until this is done:

```bash
# once per existing database, with that database's DATABASE_URL:
node scripts/migrate.js --baseline 0003     # 0002 if the HNSW index is absent
node scripts/migrate.js --status
```

Before baselining staging or production, confirm their schema matches the
baseline file. From a machine that can reach them:

```bash
pg_dump "$DATABASE_URL" --schema-only --no-owner --no-privileges \
  | grep -vE '^(SET |SELECT pg_catalog|--|\\|$)' > /tmp/live.sql
# compare table/column/index/constraint lines against migrations/0001_baseline.sql;
# the two duplicate-index pairs noted in that file's header are expected extras.
```

**Adding a migration:** create `backend/migrations/NNNN_short_name.sql` with the
next number. Additive changes only in a normal PR (new table, new nullable
column, new index). Never edit a file that has been applied anywhere; the
runner checks checksums and will stop. Put `-- migrate:no-transaction` on the
first line for statements that cannot run in a transaction
(`CREATE INDEX CONCURRENTLY`).

**Deploy:** `npm start` does not run migrations yet. Until every environment is
baselined, apply migrations by hand with that environment's `DATABASE_URL`;
after that, `start` becomes `node scripts/migrate.js && node index.js`.

Local Postgres without TLS (the devbox `dev-postgres`): set
`DATABASE_SSL=disable` alongside `DATABASE_URL`.

### Run

```bash
npm run dev     # nodemon — auto-restarts on changes
npm start       # production
```

---

## Tests

Integration tests run against a real Postgres with the tracked migrations
applied, driving the Express app through supertest. `npm test` migrates first,
then runs everything under `src/__tests__/` and `src/search/__tests__/`.

```bash
# devbox: a throwaway database on dev-postgres (create once: CREATE DATABASE scene_test)
DATABASE_URL=postgresql://dev:<password>@localhost:5433/scene_test DATABASE_SSL=disable npm test

# no database needed: middleware + pure search stages only
npm run test:unit
```

The harness (`src/__tests__/helpers.js`) refuses any database whose name does
not end in `_test`, because it truncates every table between tests. CI
(`.github/workflows/ci.yml`) builds `backend/test/Dockerfile` (PostGIS +
pgvector), runs the same `npm test`, then checks a second migrate run is a
no-op. Tests create users straight in the database and sign their own tokens,
so the auth rate limiter is never in the way; only the tests about `/auth`
go through it.

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
│   ├── storage.js        Image storage driver (Supabase prod / S3-MinIO local)
│   ├── middleware/
│   │   └── auth.js       JWT Bearer verification
│   └── routes/
│       ├── auth.js
│       ├── events.js     CRUD + RSVPs + feed + random + image upload
│       ├── map.js        Viewport pins
│       └── users.js      Profile + social graph + avatar + search
├── migrations/           Plain SQL, applied in order by scripts/migrate.js
│   ├── 0001_baseline.sql
│   ├── 0002_seed_neighborhoods.sql
│   └── 0003_hnsw_index.sql
├── scripts/
│   └── migrate.js        Migration runner (schema_migrations table, checksums)
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
- Storage sits behind `src/storage.js`, which has two drivers selected by `STORAGE_DRIVER`: `supabase` (default — Supabase Storage REST, needs `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`/`SUPABASE_BUCKET`) and `s3` (any S3-compatible endpoint — MinIO on the devbox locally, needs `S3_ENDPOINT`/`S3_BUCKET`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`).
- Either way the returned public URL is stored in `events.image_url` or `users.profile_picture`.

## Search notes

- `GET /users/search?q=` queries both `username` and `display_name` using `ILIKE` backed by GIN trigram indexes (`pg_trgm`).
- Migration `003_user_search.sql` installs the extension and creates the indexes.
