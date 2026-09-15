-- 0001_baseline — the full Scene schema as of 2026-09-15.
--
-- Provenance. The original hand-written migrations (001_init through
-- 005_reports_blocks) were never tracked: the root .gitignore ignores *.sql, and
-- the one copy of 001_init.sql that was committed (5a34a03) predates the
-- "restart" and no longer matches what runs. This file is a cleaned
-- `pg_dump --schema-only --no-owner --no-privileges` of the devbox `scene`
-- database, which had 001–005 plus src/search/sql/001_search_schema.sql applied.
-- Before marking staging or production as baselined, diff their schema against
-- this file (see backend/README.md, "Database").
--
-- Cleaned by hand: SET/psql preamble dropped, extension comments dropped, and
-- two exact-duplicate index pairs from the old migrations collapsed to one each
-- (events_location_gist_idx == events_location_idx; idx_users_*_trgm ==
-- users_*_trgm_idx). Existing databases keep their duplicates until a later
-- migration drops them; nothing depends on the names.
--
-- NOT included: the neighborhoods seed rows (0002) and the HNSW index (0003).

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

-- ── search helpers ────────────────────────────────────────────────────────────

CREATE FUNCTION public.scene_tags_text(tags text[]) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$ SELECT coalesce(array_to_string(tags, ' '), '') $$;

CREATE FUNCTION public.scene_embedding_source(p_title text, p_description text, p_hashtags text[], p_address text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT trim(both ' ' FROM concat_ws(E'\n',
    nullif(p_title, ''),
    nullif(scene_tags_text(p_hashtags), ''),
    nullif(p_description, ''),
    nullif(p_address, '')
  ));
$$;

CREATE TEXT SEARCH CONFIGURATION public.scene_english (
    PARSER = pg_catalog."default" );
ALTER TEXT SEARCH CONFIGURATION public.scene_english ADD MAPPING FOR asciiword WITH english_stem;
ALTER TEXT SEARCH CONFIGURATION public.scene_english ADD MAPPING FOR word WITH public.unaccent, english_stem;
ALTER TEXT SEARCH CONFIGURATION public.scene_english ADD MAPPING FOR numword WITH simple;
ALTER TEXT SEARCH CONFIGURATION public.scene_english ADD MAPPING FOR email WITH simple;
ALTER TEXT SEARCH CONFIGURATION public.scene_english ADD MAPPING FOR url WITH simple;
ALTER TEXT SEARCH CONFIGURATION public.scene_english ADD MAPPING FOR host WITH simple;
ALTER TEXT SEARCH CONFIGURATION public.scene_english ADD MAPPING FOR sfloat WITH simple;
ALTER TEXT SEARCH CONFIGURATION public.scene_english ADD MAPPING FOR version WITH simple;
ALTER TEXT SEARCH CONFIGURATION public.scene_english ADD MAPPING FOR hword_numpart WITH simple;
ALTER TEXT SEARCH CONFIGURATION public.scene_english ADD MAPPING FOR hword_part WITH public.unaccent, english_stem;
ALTER TEXT SEARCH CONFIGURATION public.scene_english ADD MAPPING FOR hword_asciipart WITH english_stem;
ALTER TEXT SEARCH CONFIGURATION public.scene_english ADD MAPPING FOR numhword WITH simple;
ALTER TEXT SEARCH CONFIGURATION public.scene_english ADD MAPPING FOR asciihword WITH english_stem;
ALTER TEXT SEARCH CONFIGURATION public.scene_english ADD MAPPING FOR hword WITH public.unaccent, english_stem;
ALTER TEXT SEARCH CONFIGURATION public.scene_english ADD MAPPING FOR url_path WITH simple;
ALTER TEXT SEARCH CONFIGURATION public.scene_english ADD MAPPING FOR file WITH simple;
ALTER TEXT SEARCH CONFIGURATION public.scene_english ADD MAPPING FOR "float" WITH simple;
ALTER TEXT SEARCH CONFIGURATION public.scene_english ADD MAPPING FOR "int" WITH simple;
ALTER TEXT SEARCH CONFIGURATION public.scene_english ADD MAPPING FOR uint WITH simple;

-- ── tables ────────────────────────────────────────────────────────────────────

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    username text NOT NULL,
    bio text,
    gender text,
    interests text[] DEFAULT '{}'::text[],
    profile_picture text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    display_name text
);

CREATE TABLE public.follows (
    follower_id uuid NOT NULL,
    followed_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.blocks (
    blocker_id uuid NOT NULL,
    blocked_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blocks_check CHECK ((blocker_id <> blocked_id))
);

CREATE TABLE public.events (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    host_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    location public.geography(Point,4326) NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    address text,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone,
    capacity integer,
    hashtags text[] DEFAULT '{}'::text[],
    is_private boolean DEFAULT false NOT NULL,
    show_attendees boolean DEFAULT true NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    image_url text,
    search_document tsvector GENERATED ALWAYS AS ((((setweight(to_tsvector('english'::regconfig, COALESCE(title, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, public.scene_tags_text(hashtags)), 'B'::"char")) || setweight(to_tsvector('english'::regconfig, COALESCE(description, ''::text)), 'C'::"char")) || setweight(to_tsvector('english'::regconfig, COALESCE(address, ''::text)), 'D'::"char"))) STORED,
    embedding public.vector(1024),
    embedded_at timestamp with time zone,
    embedding_source text,
    CONSTRAINT events_status_check CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text])))
);

CREATE VIEW public.events_needing_embedding AS
 SELECT id,
    public.scene_embedding_source(title, description, hashtags, address) AS source
   FROM public.events e
  WHERE ((status = 'active'::text) AND ((embedding IS NULL) OR (embedding_source IS DISTINCT FROM public.scene_embedding_source(title, description, hashtags, address))));

CREATE TABLE public.rsvps (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    event_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rsvps_status_check CHECK ((status = ANY (ARRAY['going'::text, 'interested'::text])))
);

CREATE TABLE public.refresh_tokens (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    token character varying(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.reports (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    reporter_id uuid NOT NULL,
    event_id uuid,
    reported_user_id uuid,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reports_check CHECK (((event_id IS NOT NULL) OR (reported_user_id IS NOT NULL)))
);

CREATE TABLE public.neighborhoods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    aliases text[] DEFAULT '{}'::text[] NOT NULL,
    city text NOT NULL,
    region text,
    country text DEFAULT 'US'::text NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    centroid public.geography(Point,4326) GENERATED ALWAYS AS ((public.st_setsrid(public.st_makepoint(longitude, latitude), 4326))::public.geography) STORED,
    boundary public.geography(MultiPolygon,4326),
    default_radius_m integer DEFAULT 2500 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
COMMENT ON TABLE public.neighborhoods IS 'Stage-2 location dictionary. Seed per launch city; see backend/scripts for a seeding entry point.';

CREATE TABLE public.search_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    raw_query text NOT NULL,
    sanitized_query text,
    cleaned_query text,
    rejected boolean DEFAULT false NOT NULL,
    rejection_reason text,
    sanitize_flags text[] DEFAULT '{}'::text[] NOT NULL,
    parsed_entities jsonb,
    parse_confidence real,
    llm_escalated boolean DEFAULT false NOT NULL,
    applied_filters jsonb,
    route_weights jsonb,
    lexical_count integer,
    semantic_count integer,
    fused_count integer,
    retriever_errors jsonb,
    results_shown jsonb DEFAULT '[]'::jsonb NOT NULL,
    result_count integer DEFAULT 0 NOT NULL,
    fallback_applied boolean DEFAULT false NOT NULL,
    tapped_result_id uuid,
    tapped_result_type text,
    tapped_position integer,
    tapped_at timestamp with time zone,
    latency_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT search_logs_tapped_result_type_check CHECK ((tapped_result_type = ANY (ARRAY['event'::text, 'user'::text])))
);
COMMENT ON TABLE public.search_logs IS 'Stage-8 search telemetry. Contains user queries — treat as PII, honor deletion requests.';

-- ── primary keys and unique constraints ───────────────────────────────────────

ALTER TABLE ONLY public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.users ADD CONSTRAINT users_email_key UNIQUE (email);
ALTER TABLE ONLY public.users ADD CONSTRAINT users_username_key UNIQUE (username);
ALTER TABLE ONLY public.follows ADD CONSTRAINT follows_pkey PRIMARY KEY (follower_id, followed_id);
ALTER TABLE ONLY public.blocks ADD CONSTRAINT blocks_pkey PRIMARY KEY (blocker_id, blocked_id);
ALTER TABLE ONLY public.events ADD CONSTRAINT events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.rsvps ADD CONSTRAINT rsvps_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.rsvps ADD CONSTRAINT rsvps_event_id_user_id_key UNIQUE (event_id, user_id);
ALTER TABLE ONLY public.refresh_tokens ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.refresh_tokens ADD CONSTRAINT refresh_tokens_token_key UNIQUE (token);
ALTER TABLE ONLY public.reports ADD CONSTRAINT reports_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.neighborhoods ADD CONSTRAINT neighborhoods_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.neighborhoods ADD CONSTRAINT neighborhoods_slug_key UNIQUE (slug);
ALTER TABLE ONLY public.search_logs ADD CONSTRAINT search_logs_pkey PRIMARY KEY (id);

-- ── foreign keys ──────────────────────────────────────────────────────────────

ALTER TABLE ONLY public.follows ADD CONSTRAINT follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.follows ADD CONSTRAINT follows_followed_id_fkey FOREIGN KEY (followed_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.blocks ADD CONSTRAINT blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.blocks ADD CONSTRAINT blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.events ADD CONSTRAINT events_host_id_fkey FOREIGN KEY (host_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.rsvps ADD CONSTRAINT rsvps_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.rsvps ADD CONSTRAINT rsvps_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.refresh_tokens ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reports ADD CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reports ADD CONSTRAINT reports_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reports ADD CONSTRAINT reports_reported_user_id_fkey FOREIGN KEY (reported_user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.search_logs ADD CONSTRAINT search_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX users_username_trgm_idx ON public.users USING gin (username public.gin_trgm_ops);
CREATE INDEX users_display_name_trgm_idx ON public.users USING gin (display_name public.gin_trgm_ops);
CREATE INDEX follows_followed_id_idx ON public.follows USING btree (followed_id);
CREATE INDEX blocks_blocked_id_idx ON public.blocks USING btree (blocked_id);
CREATE INDEX events_host_id_idx ON public.events USING btree (host_id);
CREATE INDEX events_location_idx ON public.events USING gist (location);
CREATE INDEX events_start_time_idx ON public.events USING btree (start_time);
CREATE INDEX events_status_idx ON public.events USING btree (status);
CREATE INDEX events_active_start_time_idx ON public.events USING btree (start_time) WHERE ((status = 'active'::text) AND (is_private = false));
CREATE INDEX events_hashtags_gin_idx ON public.events USING gin (hashtags);
CREATE INDEX events_search_document_idx ON public.events USING gin (search_document);
CREATE INDEX events_title_trgm_idx ON public.events USING gin (title public.gin_trgm_ops);
CREATE INDEX rsvps_event_id_idx ON public.rsvps USING btree (event_id);
CREATE INDEX rsvps_user_id_idx ON public.rsvps USING btree (user_id);
CREATE INDEX rsvps_event_created_idx ON public.rsvps USING btree (event_id, created_at DESC);
CREATE INDEX refresh_tokens_user_id_idx ON public.refresh_tokens USING btree (user_id);
CREATE INDEX refresh_tokens_expires_at_idx ON public.refresh_tokens USING btree (expires_at);
CREATE INDEX reports_event_id_idx ON public.reports USING btree (event_id);
CREATE INDEX reports_reported_user_id_idx ON public.reports USING btree (reported_user_id);
CREATE INDEX neighborhoods_name_trgm_idx ON public.neighborhoods USING gin (name public.gin_trgm_ops);
CREATE INDEX search_logs_user_created_idx ON public.search_logs USING btree (user_id, created_at DESC);
CREATE INDEX search_logs_empty_idx ON public.search_logs USING btree (created_at DESC) WHERE ((result_count = 0) AND (rejected = false));
CREATE INDEX search_logs_tapped_idx ON public.search_logs USING btree (created_at DESC) WHERE (tapped_result_id IS NOT NULL);
