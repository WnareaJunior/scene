-- migrate:no-transaction
-- 0003_hnsw_index — pgvector HNSW index on events.embedding.
--
-- Same statement as src/search/sql/003_hnsw_index.sql, which stays as the
-- annotated reference (tuning notes, verification queries). CONCURRENTLY cannot
-- run inside a transaction, hence the header above.
--
-- On a fresh database (CI, devbox reset) the table is empty and this is
-- instant. Staging and production already have this index; they are marked
-- with `migrate.js --baseline 0003`, never re-run.

SET maintenance_work_mem = '2GB';
SET max_parallel_maintenance_workers = 2;

CREATE INDEX CONCURRENTLY IF NOT EXISTS events_embedding_hnsw_idx
  ON events USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
