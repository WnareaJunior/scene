# Legacy migrations (historical record only)

The hand-written migrations that were applied to staging and production before
`0001_baseline.sql` existed. They are **not** run by `scripts/migrate.js`; the
baseline already contains their result. Kept so the history of how the schema
got here is reviewable.

| File | What it did |
|---|---|
| `001_init.sql` | users, follows, events, rsvps, refresh_tokens, PostGIS + uuid-ossp |
| `002_refresh_token_varchar.sql` | refresh_tokens.token → varchar(64) |
| `003_user_search.sql` | users.display_name + pg_trgm indexes |
| `004_event_image.sql` | events.image_url |
| `005_reports_blocks.sql` | reports, blocks |
| `seed_nyc.sql` | not a migration: one host user + 12 public NYC events for manual testing |

Copied from the MacBook, where the only surviving copies lived.
