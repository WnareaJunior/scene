-- Search pipeline schema.
--
-- ⚠️  NOT A MIGRATION AND NOT AUTO-APPLIED. Nothing in the codebase executes this
--     file. Per CLAUDE.md the agent does not create migration files; this is the
--     reviewable DDL for you to run by hand against Supabase, and the init script
--     for the Dockerized PostGIS+pgvector+pg_trgm test database.
--
-- Apply order matters: extensions, then columns, then backfill, then indexes.
-- Build the HNSW index AFTER backfilling embeddings — building it on an empty
-- column then inserting 100k rows is dramatically slower than the reverse, and
-- on Supabase's smaller instances it can time out.
--
-- Idempotent throughout, so it is safe to re-run and safe as a container init.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Extensions
-- ═══════════════════════════════════════════════════════════════════════════
-- postgis is assumed present (events.location is already geography).
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
-- unaccent so "cafe" matches "café" in full-text search.
CREATE EXTENSION IF NOT EXISTS unaccent;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Full-text search configuration
-- ═══════════════════════════════════════════════════════════════════════════
-- A custom config that folds accents before stemming. Created as its own config
-- rather than mutating 'english', which is shared with anything else in the DB.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'scene_english') THEN
    CREATE TEXT SEARCH CONFIGURATION scene_english (COPY = english);
    ALTER TEXT SEARCH CONFIGURATION scene_english
      ALTER MAPPING FOR hword, hword_part, word
      WITH unaccent, english_stem;
  END IF;
END
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. events — lexical + semantic columns
-- ═══════════════════════════════════════════════════════════════════════════

-- Generated tsvector. STORED (not a plain column + trigger) so it can never
-- drift from the source text, and weighted so a title match beats a description
-- match on the same term.
--
--   A = title         (what the user is most likely typing)
--   B = hashtags      (curated, high-signal)
--   C = description   (long, noisy, still worth matching)
--   D = address       (catches "on Bedford Ave")
--
-- NOTE: the immutability requirement means 'scene_english' cannot be used in a
-- generated column (config lookup by name is not immutable). Using the built-in
-- 'english' regconfig here; unaccent folding is applied at query time instead.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS search_document tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', array_to_string(coalesce(hashtags, '{}'), ' ')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(address, '')), 'D')
  ) STORED;

-- pgvector column. 1024 dims to match config.js EMBEDDING_DIM (voyage-3 default).
-- Changing the width requires dropping the index, altering the column, and
-- re-embedding every row — treat it as a one-way door.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS embedding vector(1024);

-- Freshness tracking for the embedding worker. The worker re-embeds any row
-- where embedded_at IS NULL OR embedded_at < updated_at, so an edited event's
-- vector is never silently stale.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

-- The exact text that produced `embedding`. Lets the worker skip a re-embed when
-- an UPDATE touched a column that isn't part of the composed document (an image
-- swap shouldn't cost an API call), and makes drift debuggable after the fact.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS embedding_source text;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. neighborhoods — the stage-2 location dictionary
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS neighborhoods (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text        NOT NULL,
  slug             text        NOT NULL UNIQUE,
  -- Colloquial forms: {wburg, williamsburg bk, the burg}
  aliases          text[]      NOT NULL DEFAULT '{}',
  city             text        NOT NULL,
  region           text,
  country          text        NOT NULL DEFAULT 'US',
  latitude         double precision NOT NULL,
  longitude        double precision NOT NULL,
  centroid         geography(Point, 4326)
                   GENERATED ALWAYS AS (
                     ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
                   ) STORED,
  -- Optional true boundary. When present, prefer ST_Within over ST_DWithin —
  -- neighborhoods are not circles and a radius around Williamsburg's centroid
  -- reaches into three other neighborhoods.
  boundary         geography(MultiPolygon, 4326),
  -- Radius to use when boundary IS NULL. Per-row because a neighborhood and a
  -- single venue need very different scopes.
  default_radius_m integer     NOT NULL DEFAULT 2500,
  is_active        boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE neighborhoods IS
  'Stage-2 location dictionary. Seed per launch city; see backend/scripts for a seeding entry point.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. search_logs — stage 8
-- ═══════════════════════════════════════════════════════════════════════════
-- One row per search, updated in place on tap. Deliberately wide: this is the
-- training set for learned routing and a learned re-ranker, and the columns are
-- far cheaper to record now than to backfill later.
CREATE TABLE IF NOT EXISTS search_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid REFERENCES users(id) ON DELETE SET NULL,

  -- Stage 1
  raw_query           text        NOT NULL,
  sanitized_query     text,
  cleaned_query       text,
  rejected            boolean     NOT NULL DEFAULT false,
  rejection_reason    text,
  sanitize_flags      text[]      NOT NULL DEFAULT '{}',

  -- Stage 2
  parsed_entities     jsonb,
  parse_confidence    real,
  llm_escalated       boolean     NOT NULL DEFAULT false,

  -- Stages 3 & 5
  applied_filters     jsonb,
  route_weights       jsonb,

  -- Stage 4
  lexical_count       integer,
  semantic_count      integer,
  fused_count         integer,
  retriever_errors    jsonb,

  -- Stages 6 & 7
  results_shown       jsonb       NOT NULL DEFAULT '[]',
  result_count        integer     NOT NULL DEFAULT 0,
  fallback_applied    boolean     NOT NULL DEFAULT false,

  -- Outcome
  tapped_result_id    uuid,
  tapped_result_type  text CHECK (tapped_result_type IN ('event', 'user')),
  tapped_position     integer,
  tapped_at           timestamptz,

  latency_ms          integer,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- No FK on tapped_result_id: it points at either events or users depending on
-- tapped_result_type, and the log must survive the row it references being
-- deleted. Losing click history when a host cancels a party would quietly gut
-- the training set.

COMMENT ON TABLE search_logs IS
  'Stage-8 search telemetry. Contains user queries — treat as PII, honor deletion requests.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Indexes
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Lexical ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS events_search_document_idx
  ON events USING GIN (search_document);

-- gin_trgm_ops (not gist) for `%` similarity and ILIKE: slower to build, but
-- materially faster to query, and this table is read far more than written.
CREATE INDEX IF NOT EXISTS events_title_trgm_idx
  ON events USING GIN (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS users_username_trgm_idx
  ON users USING GIN (username gin_trgm_ops);

CREATE INDEX IF NOT EXISTS users_display_name_trgm_idx
  ON users USING GIN (display_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS neighborhoods_name_trgm_idx
  ON neighborhoods USING GIN (name gin_trgm_ops);

-- ── Hard filters (stage 3) ─────────────────────────────────────────────────
-- Partial index matching the visibility predicate every retriever applies, so
-- the planner can use it directly instead of filtering after the fact.
CREATE INDEX IF NOT EXISTS events_active_start_time_idx
  ON events (start_time)
  WHERE status = 'active' AND is_private = false;

CREATE INDEX IF NOT EXISTS events_location_gist_idx
  ON events USING GIST (location);

CREATE INDEX IF NOT EXISTS events_hashtags_gin_idx
  ON events USING GIN (hashtags);

-- Stage 6 reads RSVP counts per event; without this the correlated subqueries
-- are a sequential scan of rsvps per candidate.
CREATE INDEX IF NOT EXISTS rsvps_event_created_idx
  ON rsvps (event_id, created_at DESC);

-- ── Semantic ───────────────────────────────────────────────────────────────
-- The HNSW index is NOT created here. It lives in 003_hnsw_index.sql and must
-- be built AFTER the embedding backfill — building it on an empty column and
-- then inserting N rows constructs the graph incrementally, which is
-- dramatically slower than one bulk build and can time out on smaller Supabase
-- instances. Order is: 001 → 002 → worker backfill → 003.
--
-- Until 003 runs, stage 4's semantic query still works; it just falls back to
-- an exact sequential scan, which is correct but slow. Lexical retrieval is
-- unaffected, so search degrades rather than breaks.

-- ── Logs ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS search_logs_user_created_idx
  ON search_logs (user_id, created_at DESC);

-- Partial: analytics almost always asks about searches that produced a tap.
CREATE INDEX IF NOT EXISTS search_logs_tapped_idx
  ON search_logs (created_at DESC)
  WHERE tapped_result_id IS NOT NULL;

-- Finding the zero-result queries is the whole point of stage 7 tuning.
CREATE INDEX IF NOT EXISTS search_logs_empty_idx
  ON search_logs (created_at DESC)
  WHERE result_count = 0 AND rejected = false;


-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Embedding backfill
-- ═══════════════════════════════════════════════════════════════════════════
-- The composed document. Must stay in sync with whatever the embedding worker
-- builds — a mismatch between what was embedded at write time and what the
-- worker re-embeds later silently degrades recall with no error anywhere.
CREATE OR REPLACE FUNCTION scene_embedding_source(
  p_title       text,
  p_description text,
  p_hashtags    text[],
  p_address     text
) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(both ' ' FROM concat_ws(E'\n',
    nullif(p_title, ''),
    nullif(array_to_string(coalesce(p_hashtags, '{}'), ' '), ''),
    nullif(p_description, ''),
    nullif(p_address, '')
  ));
$$;

-- Work queue for the embedding worker: rows never embedded, or whose source text
-- has changed since they were.
CREATE OR REPLACE VIEW events_needing_embedding AS
  SELECT e.id,
         scene_embedding_source(e.title, e.description, e.hashtags, e.address) AS source
  FROM events e
  WHERE e.status = 'active'
    AND (
      e.embedding IS NULL
      OR e.embedding_source IS DISTINCT FROM
         scene_embedding_source(e.title, e.description, e.hashtags, e.address)
    );

-- TODO(worker): a job that drains events_needing_embedding in batches, calls the
-- embedding adapter, and writes back embedding / embedding_source / embedded_at.
-- Not scaffolded here — it wants a queue and a retry policy, not a cron loop, and
-- the batch size depends on the provider's rate limit.


-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Retention
-- ═══════════════════════════════════════════════════════════════════════════
-- search_logs holds raw user queries. Decide a retention window before launch —
-- 90 days is a reasonable default for click data — and make sure account
-- deletion (see the existing users delete flow) either nulls user_id or removes
-- these rows. The ON DELETE SET NULL above handles the FK, but the raw_query
-- text can still be identifying on its own.
--
-- TODO(privacy): confirm this against PRIVACY.md before the table sees prod traffic.
