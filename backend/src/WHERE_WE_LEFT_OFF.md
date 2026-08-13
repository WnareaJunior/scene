# Where we left off — App Store resubmission

_Session date: 2026-08-12. Status: **resubmitted to App Review**, waiting on Apple._
_(Lives in `backend/src/` per the agent scope rules, same as `search/DEPLOY_STATUS.md`.)_

## What was submitted

- **Build 9** (version 1.0.0, build number 9), cut from `main` at `08457bf` and
  uploaded to App Store Connect via `eas submit` on 2026-08-12.
  - EAS build ID: `4ed9c73f-1770-4eaa-b1f8-9012fb8546c8`
  - ASC app ID: `6792423931`
  - Gotcha learned: `eas build` alone does NOT upload to ASC — build 8 was
    compiled but never submitted, which is why the ASC build picker looked empty.
    `eas submit --platform ios --profile production --id <build-id> --non-interactive`
    works from this machine (ASC API key stored on EAS servers).

## What build 9 fixes (vs rejected build 7)

| Rejection | Fix | Where |
|---|---|---|
| 5.1.1(v) — no account deletion | Full deletion flow | PR #53: `DELETE /users/me` (users.js:108) + `DeleteAccountSheet` in ProfileScreen |
| 2.1(a) — couldn't verify features | NYC map fallback + demo accounts + seeded content | commit `6aa02f6` + prod data (below) |
| (found ourselves) follower/following lists always empty | Envelope unwrap + `followers_count` in list queries | PR #54 (`ProfileScreen.openList`, users.js followers/following) |

## Production data changes made this session

- **Seeded demo content** (insert-only): 12 curated users + 18 upcoming public
  NYC parties + 88 follows + 143 RSVPs. All seeded users have `@scene-seed.app`
  emails. **Cleanup after approval:**
  `DELETE FROM users WHERE email LIKE '%@scene-seed.app';` (cascades).
- **Demo accounts** (created by Wilson, passwords in ASC only):
  `applereview@getscene.app` and `applereview2@getscene.app` — each left with
  12 followers, following 8, 4 RSVPs. The second is the spare in case the
  reviewer deletes the first while testing 5.1.1(v).
- **Deleted** junk event "Litness" (`380219f3-…`, SF coords, dated June 2028,
  host `test@example.com`). It sat inside the reviewer's ~100km metro probe
  from Cupertino and suppressed the NYC fallback — likely why the original
  fallback + seed didn't save build 7. Verified post-delete: Cupertino probe
  returns 0 events.
- DB access: `backend/.env` `DATABASE_URL` is prod Supabase and is NOT
  URL-parseable (raw `%` in password) — recreate the psql wrapper that parses
  components and passes `PGPASSWORD` (see `search/DEPLOY_STATUS.md`).

## If Apple rejects again, check first

1. Did the reviewer see the NYC fallback? Any *new* upcoming public event
   within ~100km of Cupertino suppresses it (fallback fires only on exactly
   zero). Query: envelope `ST_MakeEnvelope(-122.53, 36.82, -121.53, 37.82)`
   against the pins-endpoint filters (map.js:33–39).
2. Are seeded parties still upcoming? They span 2026-08-14 → 2026-09-08;
   after that the map thins out again.
3. Improvement worth shipping regardless: make the fallback fire when nearby
   count is *small*, not exactly zero, or fly to wherever events actually are.

## Open threads elsewhere

- Search pipeline: step 3 (embeddings) still blocked on `VOYAGE_API_KEY` +
  spend approval — see `search/DEPLOY_STATUS.md`. The 18 new seeded events
  also have no embeddings yet (expected; backfill covers them).
- Branch `claude/scene-search-pipeline-c4wqjj` still has that work; the
  follow-list fix went out separately from `main`.
