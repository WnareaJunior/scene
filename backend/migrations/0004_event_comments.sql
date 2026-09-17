-- 0004_event_comments — the comment thread on an event.
--
-- Read follows the event: if you can see the event, you can read its comments.
-- Write is narrower — you must hold an RSVP, or be the host — and that rule
-- lives in routes/events.js, not here, because "has an rsvp" is a join and not
-- something a single row can constrain.
--
-- Deletes are hard, matching rsvps and follows. No soft-delete column on
-- purpose: a tombstone reading "comment deleted" on someone's party is a worse
-- artifact than the gap it replaces.
--
-- Note for anyone purging accounts (see scripts/purge-*): both foreign keys
-- cascade, so deleting a user takes their comments with them, and deleting an
-- event takes the whole thread.
--
-- gen_random_uuid() is built into Postgres 13+. The older tables use
-- uuid_generate_v4(), but on Supabase uuid-ossp lives in the `extensions`
-- schema, so `public.uuid_generate_v4()` does not exist there.

CREATE TABLE public.event_comments (
    id         uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id   uuid NOT NULL,
    user_id    uuid NOT NULL,
    body       text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_comments_body_check
      CHECK (length(btrim(body)) >= 1 AND length(body) <= 500)
);

ALTER TABLE ONLY public.event_comments
  ADD CONSTRAINT event_comments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.event_comments
  ADD CONSTRAINT event_comments_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.event_comments
  ADD CONSTRAINT event_comments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- The list query is always "this event, ordered by time". It pages newest-first
-- so offset walks backwards through history, then reverses for the response;
-- a btree scans either direction, so one ascending index serves both.
CREATE INDEX event_comments_event_created_idx
  ON public.event_comments USING btree (event_id, created_at);

CREATE INDEX event_comments_user_id_idx
  ON public.event_comments USING btree (user_id);

COMMENT ON TABLE public.event_comments IS
  'Comment thread on an event. Posting requires a going/interested RSVP or being the host; enforced in routes/events.js, not by a constraint.';
