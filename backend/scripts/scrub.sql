-- Scrub a restored snapshot so real people's data can sit on a dev machine or
-- a CI runner. Run by scripts/snapshot-restore.sh against the LOCAL copy; it
-- is never meant for a hosted database, and refuses one that looks like
-- Supabase.
--
--   * every email becomes <id>@scrub.test (ids are unique, so emails stay unique)
--   * every password becomes "password123" (bcrypt, cost 10)
--   * sessions, reports, blocks and search logs are emptied
--
-- One transaction: a half-scrubbed copy never exists.

BEGIN;

DO $$
BEGIN
  -- Supabase keeps its own auth schema; snapshot-restore.sh leaves it out of
  -- the dump, so a database that has it is a hosted one, not a restored copy.
  IF to_regclass('auth.users') IS NOT NULL THEN
    RAISE EXCEPTION 'scrub.sql: auth.users exists, so this looks like a hosted Supabase database; refusing';
  END IF;
END
$$;

UPDATE users
   SET email = id::text || '@scrub.test',
       password_hash = '$2a$10$CRs1VqcqTOefgDfWzpSZze4qD.UZWQQH0Nbi8ZFrQ/uD7cqJhKS1.';

TRUNCATE refresh_tokens, reports, blocks, search_logs;

COMMIT;
