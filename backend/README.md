# Scene — Backend

Node.js + Express REST API. Serves `http://localhost:3000/api/v1` locally, `https://scene-staging-pr6j.onrender.com/api/v1` on staging and `https://scene-19ss.onrender.com/api/v1` in production.

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
runner checks checksums and will stop. Checksums ignore line endings, so a
Windows checkout (CRLF) and the server (LF) agree. Put `-- migrate:no-transaction` on the
first line for statements that cannot run in a transaction
(`CREATE INDEX CONCURRENTLY`).

**Deploy:** `npm start` is `node scripts/migrate.js --if-enabled && node index.js`.
Pending migrations run at boot only where the `MIGRATE_ON_BOOT=true` env var is
set; everywhere else the runner exits 0 without connecting, and migrations are
applied by hand with `scripts/with-env.sh <env> node scripts/migrate.js`. A
failed migration exits 1, so the API never starts on a half-migrated schema;
Render cancels that deploy and keeps the previous instance serving. (Render's
pre-deploy command would be the natural home for this, but it is paid-plan
only.)

Turning it on for an environment, in this order:

1. The Render service's start command is `npm start` (not `node index.js`).
2. The database is baselined and caught up:
   `scripts/with-env.sh <env> node scripts/migrate.js --status` shows nothing pending.
3. Set `MIGRATE_ON_BOOT=true` on that Render service.

With the switch on and the database *not* baselined, every boot fails with the
"already has the Scene schema" refusal, so step 2 is not optional. Because the
old instance keeps serving while the new one migrates, every migration must be
safe for the previous release to run against — which the additive-only rule
below already guarantees.

Local Postgres without TLS (the devbox `dev-postgres`): set
`DATABASE_SSL=disable` alongside `DATABASE_URL`.

### Run

```bash
npm run dev     # nodemon — auto-restarts on changes
npm start       # production
```

---

## Seed data

`scripts/seed.js` builds a deterministic dataset: the fixed `@example.com`
host roster, extra `@seed.test` users, NYC events across all five boroughs,
follows, and RSVPs weighted toward parties starting soon.

```bash
npm run seed                                  # profile smoke: 12 hosts, 30 events
node scripts/seed.js --profile nyc --seed 7   # 200 events, 40 extra users
node scripts/seed.js --profile load           # 2,000 users, 20,000 events
npm run seed:reset                            # truncate app tables first — local hosts only
node scripts/seed.js --profile nyc --events 60 --dry-run
```

`--reset` refuses to run unless `DATABASE_URL` points at a local host
(`localhost`, `127.0.0.1`, `devbox`, `dev-postgres`, `postgres`); pass
`--i-mean-it` to override. All seeded passwords are `SeedHost123!` (hosts) and
`SeedUser123!` (extra users). The e2e login account is separate:
`scripts/seed-e2e-account.js`. Embeddings are not seeded; the in-process sweep
or `src/search/worker/embed-events.js --once` fills them in.

### Snapshot a cloud database into a local one

```bash
scripts/snapshot-restore.sh staging postgresql://dev:<pw>@localhost:5433/scene_snapshot
```

Dumps the source through `with-env.sh` (so the environment name is typed),
excludes the rows of `search_logs` and `refresh_tokens` and Supabase's own
schemas (`auth`, `storage`, …), restores into the local target, and checks
that `users`, `events` and `schema_migrations` came through. `pg_restore`
usually reports a few errors for platform leftovers; the script reports them
and relies on that check instead. Then it runs `scripts/scrub.sql`: every email
becomes `<id>@scrub.test`, every password becomes `password123`, and
sessions, reports, blocks and search logs are emptied, in one transaction.
`scrub.sql` refuses a database that has `auth.users` (a hosted one). The
target host must be local. Needs `pg_dump`, `pg_restore` and `psql` of the
source's major version (17) on PATH.

### Rehearse migrations before applying them

```bash
scripts/rehearse-migrations.sh staging postgresql://dev:<pw>@localhost:5433/scene_rehearsal
```

Run it from the branch that adds the migrations. It snapshots and scrubs the
source into the local target, shows `migrate.js --status`, applies the pending
files (timed), and checks that a second run is a no-op. If it fails here, it
would have failed on the hosted database.

Without a local Postgres, run it on a CI runner instead: **Actions →
rehearse-migrations → Run workflow**, with the branch as `ref`. The scripts
come from `main` and only `backend/migrations/` from that branch, so a branch
cut before a tooling fix still rehearses with current tooling. It uses the
`staging` environment's `STAGING_DATABASE_URL`, the same PostGIS + pgvector
image as CI, and uploads nothing.

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

## Deploying

- **Staging** (Render `scene-staging`, `https://scene-staging-pr6j.onrender.com`, My project / Staging) auto-deploys from `main`.
- **Gate into main**: branch protection requires the `backend` and `web-e2e`
  CI checks on an up-to-date branch before a PR can merge.
- **Staging check**: `staging-smoke` runs on every push to `main`. It waits for
  staging's `/health/ready` to report the merged commit, then runs the
  Playwright suite against the staging API. It writes only to the staging
  database (e2e account reset, event top-up, cleanup of `e2e+*` users) and
  refuses the production host and project. Setup is in the workflow header:
  a `staging` GitHub environment with `STAGING_DATABASE_URL` and
  `STAGING_E2E_KEY`, plus `E2E_RATE_LIMIT_BYPASS` and
  `http://localhost:4173` in `ALLOWED_ORIGINS` on the staging Render service.
- **Production** deploys only through the `deploy-prod` GitHub Actions workflow
  (`Actions → deploy-prod → Run workflow`, with a SHA or `main`). It runs under
  the `production` environment, which needs a reviewer's approval. It refuses
  commits that are not on `main`, sends the commit SHA to the Render deploy
  hook, and waits until `/health/ready` reports that SHA with no pending
  migrations. Render's own auto-deploy for the production service is switched
  off so nothing reaches prod by accident.
- **Web app**: `deploy-web` no longer runs on every merge. `deploy-prod` calls
  it with the same SHA once production is ready, because the web build talks
  to the production API.
- **Keep-warm**: Render's free tier sleeps after ~15 idle minutes. Uptime Kuma
  on the devbox pings `/health` every 5 minutes (monitor "Scene API (prod)")
  and alerts through ntfy; that replaced the GitHub cron, which could not hold
  a 10-minute schedule.
- **Migrations on deploy**: `npm start` applies pending migrations when the
  service has `MIGRATE_ON_BOOT=true`, and a failed migration fails the deploy.
  Off until each environment is baselined; see "Database" above for the order.

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
| GET | `/events/invite/:token` | Event behind an invite link (see "Invite links") |
| POST | `/events/:eventId/invite-link` | Shareable link for a party |
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
| POST | `/events/:eventId/rsvp` | `{ status, inviteToken? }` | RSVP — `going` enforces capacity; `inviteToken` admits a link holder to a private party |
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

### Invite links (public, no `/api/v1` prefix)

A party's shareable link is `https://<share host>/e/<token>`. One URL serves
three readers: link-preview crawlers (iMessage builds its card from the Open
Graph tags), phones with Scene installed (universal links / app links hand the
URL to the app, which opens the party's sheet), and phones without it (a web
page with "get scene").

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/events/:eventId/invite-link` | Bearer | Returns `{ url, token }`, minting the token on first share. Any viewer of a public party; only the host of a private one (403); 409 once cancelled |
| GET | `/api/v1/events/invite/:token` | Bearer | The full event behind a token. Holding the token is the access check; 404 for unknown or malformed tokens and for viewers the host blocked |
| POST | `/api/v1/events/:eventId/rsvp` | Bearer | Also accepts `inviteToken`, which is how a non-follower joins a private party |
| GET | `/e/:token` | none | The invite page: OG tags + a script-free page. 404 page for a dead token |
| GET | `/e-card.png` | none | 1024×1024 preview image for parties without a photo |
| GET | `/.well-known/apple-app-site-association` | none | iOS universal links. 404 until `APPLE_TEAM_ID` is set |
| GET | `/.well-known/assetlinks.json` | none | Android app links. 404 until `ANDROID_CERT_SHA256` is set |

A token unlocks exactly one party, only on the fetch and the RSVP. It is not
part of the visibility predicate (`src/eventVisibility.js`), so holding a link
never puts a private party on your map, feeds, profile lists or search.

| Env var | Default | Purpose |
|---|---|---|
| `SHARE_BASE_URL` | the request's own origin | The origin links are built on, e.g. `https://scene.party`. Must be a bare https origin; production refuses to boot otherwise. **Must name the same host as the app build's `EXPO_PUBLIC_SHARE_HOST`.** |
| `APPLE_TEAM_ID` | unset (AASA 404s) | 10-character Team ID; publishes `apple-app-site-association` for `<team>.com.wilsonnarea.scene` |
| `ANDROID_CERT_SHA256` | unset (assetlinks 404s) | Comma-separated SHA-256 signing-cert fingerprints (`AA:BB:…`) |
| `APP_STORE_URL` | the public TestFlight link | Where "get scene" goes |
| `APP_STORE_ID` | unset | `6792423931` once the app is live on the App Store: turns on Safari's smart banner |
| `INVITE_TIMEZONE` | `America/New_York` | Time zone for the time on the card (events store no zone) |
| `IOS_BUNDLE_ID` / `ANDROID_PACKAGE` | `com.wilsonnarea.scene` | Only if the app identifiers ever change |

**Preview gotcha:** Render's free tier sleeps after ~15 idle minutes. iMessage
fetches the preview once, from the sender's phone, and gives up quickly; a
cold start can outlast it, and the card silently degrades to a bare URL. That
is not fixable in code. Production is kept warm by the Uptime Kuma ping, which
is best-effort; the real fix is an always-on instance (Render Starter) behind
the custom domain.

**Installing from the link:** there is no deferred deep link. Someone without
the app installs it from the page, then taps the link again, and the page
tells them so. See "Deferred deep linking" below for the options.

#### Invite links: domain day

Everything below is configuration plus one app build. No code changes.
Example host: `scene.party` (use whatever you bought; a subdomain like
`go.example.com` works the same way).

1. **Render: add the domain to the production service.** Dashboard →
   `scene-19ss` → Settings → Custom Domains → Add → `scene.party`. Render
   shows the DNS records to create and issues the TLS certificate itself once
   they resolve.
2. **DNS, at the registrar**, exactly as Render's page shows. At the time of
   writing that is:
   - apex (`scene.party`): `A @ 216.24.57.1`, or `ALIAS`/`ANAME @ scene-19ss.onrender.com` if the registrar supports it
   - a subdomain (`go.scene.party`): `CNAME go scene-19ss.onrender.com`
   - delete any `AAAA` records on that name (Render's docs require it; they break verification)

   Wait for Render to show the domain as verified with a certificate, then
   check `curl -sI https://scene.party/health` returns 200.
3. **Render env vars** (production service → Environment), then redeploy
   through `deploy-prod`:
   - `SHARE_BASE_URL=https://scene.party`
   - `APPLE_TEAM_ID=<Team ID>`: developer.apple.com → Account → Membership details
   - `ANDROID_CERT_SHA256=<fingerprint>`: `eas credentials -p android` → production keystore → SHA-256. Once the app is on Google Play with Play App Signing, also add Play Console → Test and release → App integrity → App signing key certificate → SHA-256, comma-separated
   - `APP_STORE_URL=https://apps.apple.com/app/id6792423931` and `APP_STORE_ID=6792423931`, once the app is live on the App Store (until then leave the TestFlight default)

   `APPLE_TEAM_ID` and `ANDROID_CERT_SHA256` do not depend on the domain; they
   can be set today and make links on the Render host open the app too.
4. **App: point the build at the domain.** In `frontend/eas.json`, add
   `"EXPO_PUBLIC_SHARE_HOST": "scene.party"` to the `production` profile's
   `env` (bare hostname, no `https://`). `npx expo config --type public`
   should then list `applinks:scene.party` and `applinks:scene-19ss.onrender.com`.
5. **Rebuild; an OTA update will not do.** Associated domains and intent
   filters are compiled into the binary:
   ```bash
   cd frontend
   eas build -p ios --profile production
   eas submit -p ios --profile production --id <build-id>
   eas build -p android --profile production   # when Android ships
   ```
   The iOS build syncs the Associated Domains capability onto the App ID in
   the Apple Developer portal (EAS does this automatically; set
   `EXPO_NO_CAPABILITY_SYNC=1` to do it by hand instead).
6. **Verify iOS.**
   ```bash
   curl -si https://scene.party/.well-known/apple-app-site-association   # 200, application/json, no redirect
   curl -s  https://app-site-association.cdn-apple.com/a/v1/scene.party  # Apple's CDN copy: what devices actually get
   ```
   The CDN can lag hours behind a change. Then install the new build from
   TestFlight (iOS fetches the file at install time), paste a link into Notes
   or Messages and tap it: it should open Scene on the party. Long-press shows
   "Open in Scene". Typing the URL into Safari's address bar never opens an
   app; that is iOS behavior, not a bug.
7. **Verify Android.**
   ```bash
   curl -s https://scene.party/.well-known/assetlinks.json
   adb shell pm verify-app-links --re-verify com.wilsonnarea.scene
   adb shell pm get-app-links com.wilsonnarea.scene    # scene.party: verified
   ```
8. **Verify the card.** Mint a link from the app ("send it"), text it to
   yourself, and check the photo card. The `og:url` and `og:image` in
   `curl -s https://scene.party/e/<token>` should both be on `scene.party`.

**Old links keep working.** Links already sent on
`scene-19ss.onrender.com/e/…` are served by the same service, so they still
render. The app keeps the Render host in its associated domains next to the
new one, so they still open the app. No redirect is needed, and none should be
added on the Render host: it is also the API origin every installed build
calls.

**The one switch, and how a mismatch shows up.** `SHARE_BASE_URL` (API) and
`EXPO_PUBLIC_SHARE_HOST` (app build) must name the same host. If they
disagree, links still work as web pages but never open the app. The build
prints the `SHARE_BASE_URL` it expects, the API logs the host it expects at
boot, and the app logs a warning each time it receives a link on a host it
was not built for.

#### Deferred deep linking (not built)

"Install, then open straight to the party" needs something to carry the token
across the App Store, which drops it. The options:

- **A link service (Branch, AppsFlyer OneLink, Adjust).** The only thing that
  works reliably on iOS: fingerprinting plus their SDK. It costs an SDK, a
  privacy-label change and a vendor in the link path, and it does nothing for
  TestFlight installs.
- **Clipboard.** The page copies the link and the app reads it on first
  launch. iOS 16+ shows a "paste from Safari?" prompt for that, which reads as
  creepy on a first launch. The page is also deliberately script-free.
- **Android Play Install Referrer.** First-party and reliable: the "get scene"
  button links to the Play listing with `&referrer=invite%3D<token>`, and the
  app reads it once on first launch with `react-native-play-install-referrer`.
  Android only, and only once the app is on Google Play.

**Recommendation:** keep "installed it? tap the link again" (shipped) until
installs from links are a measurable share of signups. Then add the Play
Install Referrer when Android launches (small, no vendor), and use Branch for
iOS only if the re-tap drop-off turns out to matter.

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
