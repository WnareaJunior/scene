-- 0006_event_invite_links — the token behind a shareable party link.
--
-- A link is https://<api host>/e/<invite_token>. The token is what makes a
-- private party reachable by someone who neither follows the host nor has
-- RSVP'd: possession of it admits the holder to that one event (the single
-- fetch and the RSVP), and to nothing else. It is deliberately not part of the
-- list visibility predicate in src/eventVisibility.js.
--
-- Nullable and minted lazily by POST /events/:id/invite-link, so the thousands
-- of parties nobody ever shares never get one, and no backfill is needed.
-- Unique so a token resolves to exactly one event; the unique constraint's
-- index is also the lookup path for GET /e/:token.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS invite_token text;

ALTER TABLE ONLY public.events
  ADD CONSTRAINT events_invite_token_key UNIQUE (invite_token);
