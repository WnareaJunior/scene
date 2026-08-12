# Scene — Web v1 E2E Suite

Playwright suite for the web build of Scene (Expo web target). Twelve tests
across three flows — auth (A1–A8), feed (B1–B2), profile (C1–C2) — on three
projects: `mobile-webkit` (iPhone 14), `mobile-chromium` (Pixel 7),
`desktop-chromium` (1280×720).

## Running locally

```bash
# 1. Backend on :3000 (dev mode allows localhost CORS; bypass key kills the
#    auth rate limiter for test traffic)
cd backend && E2E_RATE_LIMIT_BYPASS=local-e2e-key node index.js

# 2. Web bundle pointed at it (-c clears Metro's cache — it does NOT key on
#    env vars, so a stale bundle silently keeps the old API URL)
cd frontend && EXPO_PUBLIC_API_URL=http://localhost:3000 npx expo export --platform web -c

# 3. Tests (Playwright starts the static server itself)
cd e2e && cp .env.example .env   # fill in E2E_PASSWORD and E2E_KEY=local-e2e-key
npm install && npx playwright install webkit chromium
npm test
```

In CI (`.github/workflows/e2e.yml`) the same build runs against the deployed
API. That deploy must have `ALLOWED_ORIGINS` including `http://localhost:4173`
and `E2E_RATE_LIMIT_BYPASS` matching the repo secret — see the workflow header.

## Seeded account

Login/feed/profile tests use one pre-seeded account (`E2E_EMAIL` /
`E2E_PASSWORD`, secrets in CI, `.env` locally). It must exist on the target
API **with a bio set**. To (re)create one:

```bash
curl -X POST $API/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"scene.e2e@e2e.test","password":"<pw>","username":"scene_e2e"}'
curl -X PATCH $API/api/v1/users/me -H "Authorization: Bearer <accessToken>" \
  -H 'Content-Type: application/json' -d '{"bio":"professional third wheel — i know where the party is"}'
```

The feed tests need **≥21 upcoming public events** on the target DB so page 1
is full and page 2 is non-empty (`backend/scripts/seed.js` provides this;
seeded events expire 0–21 days out, so a long-dormant DB needs a re-seed).

## Conventions

- **Selectors:** `getByTestId` only — RNW class names are generated and
  unstable. `testID="<screen>-<element>"`, e.g. `auth-email-input`,
  `feed-post-card`, `profile-save`. The auth screen serves login and signup,
  so its ids are `auth-*`, not `signup-*`.
- **Auth via storage state:** `auth.setup.ts` logs in once through the UI and
  saves `.auth/user.json`; feed/profile specs reuse it. Only `auth.spec.ts`
  drives the login form.
- **One worker, no parallelism:** every test shares one seeded account and a
  rate-limited auth API; C1/C2 would race on the bio across projects.
- **Flake policy:** `retries: 1` in CI (to capture the trace), `0` locally. A
  test that needs the retry to pass gets fixed or deleted.
- **RNW gotchas baked into the tests** (don't "simplify" these away):
  - `fill()` on a multiline `TextInput` updates the DOM but not RNW's state on
    chromium — C2 types with `pressSequentially` instead.
  - `el.scrollTo()` is silently ignored on RNW scroll containers —
    B2 assigns `el.scrollTop` to trigger pagination.

## Spec deviations (agreed cuts, v1)

- **C2 edits the bio, not a display name** — the schema has no display-name
  column and `PATCH /users/me` doesn't accept `username` (changing that would
  need a migration, which is out of scope).
- **B2 asserts pagination via scroll**; the feed also renders a "more parties"
  button as a human-visible fallback, which the test ignores.

## Web v1 handoff notes

**Gated / stubbed on web** (native untouched; web resolves `.web.js(x)` files):

| Surface | Web behavior |
|---|---|
| Map, create-party, search sheet, onboarding | Not on web. `Scene.web.jsx` replaces the swipe track with feed + profile |
| Avatar upload / image uploads | Hidden; `uploadPart.web.js` throws if reached (`expo-file-system` is native-only) |
| Account deletion, follower lists, user sheets | iOS app only |
| RSVP writes | Feed is read-only; `EventCard` hides the RSVP button when no handler is passed |
| Token storage | `localStorage` (`tokenStore.web.js`) vs SecureStore on native — **not httpOnly cookies; revisit before public launch** |
| Sign-out confirm | Plain button on web (native's `Alert.alert` confirm is a no-op in RNW) |

**Backend changes that must be deployed before CI can go green against prod:**
rate-limit bypass (`E2E_RATE_LIMIT_BYPASS` + `X-E2E-Key`), `Cache-Control:
no-store` on `/api/v1` (chromium revived stale `GET /users/me` from disk cache
after reload without it), CORS `allowedHeaders` + `ALLOWED_ORIGINS` for the
web origins.

**Known issues (accepted for v1):**
- `e2e+*@e2e.test` users accumulate on the target DB — cleanup script later.
- No password reset on web.
- Web deploy to a static host (Vercel et al.) is not set up yet; the web app
  currently exists as `npx expo export --platform web` output only. When
  deploying, add the deploy domain to `ALLOWED_ORIGINS`.
- `expo export` must be re-run with `-c` whenever `EXPO_PUBLIC_API_URL`
  changes (Metro cache ignores env).
