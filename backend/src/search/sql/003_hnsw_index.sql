-- pgvector HNSW index (blocker #1, final step).
--
-- ⚠️  RUN THIS LAST — after 001, after 002, and after the embedding worker has
--     drained. Building the graph on an empty column and letting inserts fill it
--     in is dramatically slower than one bulk build, and on smaller Supabase
--     instances the incremental path can time out.
--
--     Order: 001 → 002 → `node src/search/worker/embed-events.js --once` → 003
--
-- Until this runs, semantic retrieval still returns correct results — Postgres
-- falls back to an exact sequential scan over the embedding column. It is slow,
-- not wrong, and lexical retrieval is unaffected, so search degrades gracefully.
-- That makes this step safe to defer if the backfill is still running.

-- Check the backfill actually finished before building. If `unembedded` is not
-- zero, the index will be built over a partial corpus and those events will be
-- invisible to semantic search until it is rebuilt.
--
--   SELECT count(*) FILTER (WHERE embedding IS NULL) AS unembedded,
--          count(*) FILTER (WHERE embedding IS NOT NULL) AS embedded
--     FROM events WHERE status = 'active';

-- Build memory. The default (64MB) makes large HNSW builds crawl. Raise it for
-- this session only; it is per-connection and reverts on disconnect. Do not set
-- this globally — it is allocated per concurrent build.
SET maintenance_work_mem = '2GB';

-- Parallel workers for the build. 0 disables parallelism; raise on a larger
-- instance. Supabase's smaller tiers will not honor a high value.
SET max_parallel_maintenance_workers = 2;

-- ── The index ────────────────────────────────────────────────────────────────
-- Cosine distance, matching the `<=>` operator stage 4 uses. A mismatch here is
-- silent: the planner simply ignores the index and every semantic query
-- sequential-scans, with no error to tell you why search got slow.
--
--   m = 16                — graph connectivity. Higher = better recall, more RAM.
--   ef_construction = 64  — build-time candidate depth. Higher = better graph,
--                           slower build.
--
-- pgvector's defaults, and the right starting point. Tune only against measured
-- recall@5 from the relevance harness, never by feel.
--
-- CONCURRENTLY so the build does not block writes to `events` for its duration.
-- It costs a second table pass and cannot run inside a transaction block — if
-- your client wraps statements in a transaction, run this statement on its own.
-- On a fresh table with no live traffic, dropping CONCURRENTLY is faster.
CREATE INDEX CONCURRENTLY IF NOT EXISTS events_embedding_hnsw_idx
  ON events USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── Verify ───────────────────────────────────────────────────────────────────
-- A CONCURRENTLY build that fails leaves an INVALID index behind that the
-- planner will not use — and nothing warns you. This must return zero rows.
--
--   SELECT c.relname
--     FROM pg_class c
--     JOIN pg_index i ON i.indexrelid = c.oid
--    WHERE c.relname = 'events_embedding_hnsw_idx' AND NOT i.indisvalid;
--
-- If it returns a row: DROP INDEX events_embedding_hnsw_idx; and re-run.

-- Confirm the planner actually chooses it. Look for "Index Scan using
-- events_embedding_hnsw_idx" — a Seq Scan means the operator class doesn't match
-- the query operator, or there are too few rows for the planner to bother.
--
--   EXPLAIN ANALYZE
--   SELECT id FROM events
--    WHERE embedding IS NOT NULL
--    ORDER BY embedding <=> (SELECT embedding FROM events WHERE embedding IS NOT NULL LIMIT 1)
--    LIMIT 10;

-- ── Recall tuning ────────────────────────────────────────────────────────────
-- Query-time recall is governed by hnsw.ef_search (default 40). If recall@5
-- comes in low in the relevance harness, raise it per session before rebuilding
-- the index with a higher m — it is a far cheaper experiment:
--
--   SET LOCAL hnsw.ef_search = 100;
