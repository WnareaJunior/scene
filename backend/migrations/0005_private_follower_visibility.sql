-- 0005_private_follower_visibility — widen the partial index behind the
-- visibility predicate.
--
-- Private events used to be invisible to everyone but the host and people
-- already going, so `is_private = false` was a constant every list query
-- applied and the index could bake it in. It is now viewer-dependent: a private
-- event is also visible to anyone following the host (see src/eventVisibility.js).
--
-- A partial index cannot express "depends who is asking", so the predicate has
-- to come out of the index or the planner stops using it entirely. What is left
-- -- status = 'active' -- is still the useful part: cancelled events are dead
-- weight in every query, and they never come back.
--
-- Not CONCURRENTLY. Both hosted databases are in the hundreds of rows, where
-- this is milliseconds, and the no-transaction header that CONCURRENTLY
-- requires would cost the atomicity of the swap for no practical gain. If this
-- table ever reaches a size where that matters, rewrite it as two migrations:
-- create the new index concurrently, then drop the old one.

DROP INDEX IF EXISTS events_active_start_time_idx;

CREATE INDEX IF NOT EXISTS events_active_start_time_idx
  ON events (start_time)
  WHERE status = 'active';

-- The predicate now joins follows on (follower_id, followed_id) for every
-- candidate row. follows_pkey already covers that pair, so the EXISTS is an
-- index lookup rather than a scan -- no new index needed here, but it is the
-- thing to check first if discover gets slow.
