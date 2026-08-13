# Search pipeline — deployment runbook

**Audience: a Claude Code session running on the developer's own machine**, with
the credentials and network access the cloud session that wrote this code did
not have. That asymmetry is the whole reason this file exists — the pipeline is
written and pushed, but nothing has ever touched a real database.

Branch: `claude/scene-search-pipeline-c4wqjj`

---

## What you are doing

Bringing the search pipeline from "code exists" to "endpoint returns real
results," in four steps that **must run in this order**:

```
001 schema  →  002 seed  →  embedding worker  →  003 HNSW index
```

Each step has a verification query. Run it. Do not proceed on an unverified
step — every failure mode below is silent, and three of them produce a system
that looks healthy and returns quietly wrong results.

---

## Before you start

### Read these first
- `backend/src/search/README.md` — architecture and design decisions
- `CLAUDE.md` — project rules. Note especially: **never modify migrations**,
  **open a PR, never push to main**, and the OpenViking MCP requirement (OV is
  reachable on your machine at `localhost:1933`; it was not reachable from the
  cloud container, which is why this code was written without it).

### Rules for this task
- **Never print, echo, or commit a credential.** Verify `DATABASE_URL` is set
  with `echo "${DATABASE_URL%%://*}://…"`, which shows the scheme only.
- **`.env` is gitignored and stays that way.**
- **Do not create files in `backend/migrations/`.** The SQL under
  `backend/src/search/sql/` is deliberately not a migration — CLAUDE.md forbids
  the agent creating migration files, and there is no migration tooling in this
  repo. If you think that convention should change, raise it, don't do it.
- **Do not `git add` anything under `sql/` without `-f`.** `.gitignore` line 12
  is `*.sql`, which silently dropped every one of these files from three
  commits before it was caught. They are tracked now; keep them that way.
- **Stop and ask** rather than improvise on any abort condition below.

### Environment snags already hit
1. **`git pull` fails with "cannot pull with rebase: You have unstaged
   changes."** Run `git status --short` and *look* before stashing — don't
   assume it's junk. If it's real work, commit it to its own branch first.
2. **`psql "$DATABASE_URL"` connects to a local socket and fails with `database
   "<username>" does not exist`.** That means `DATABASE_URL` is unset in the
   shell, so psql fell back to libpq defaults. Load it:
   ```bash
   set -a; source backend/.env; set +a
   ```

---

## Step 0 — Size the job

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM events WHERE status='active';"
```

This number decides Step 1's risk profile. **Report it before proceeding.**

| Active events | Step 1 |
|---|---|
| under ~50k | Run straight through; it completes in seconds |
| 50k–500k | Schedule a quiet window — see the lock warning below |
| over 500k | **Stop and ask.** 001 needs splitting into a lock-light variant first |

Also confirm the extensions are available — pgvector is gated behind the
Supabase dashboard on some plans:

```bash
psql "$DATABASE_URL" -c "SELECT name, installed_version FROM pg_available_extensions WHERE name IN ('vector','pg_trgm','postgis','unaccent');"
```

All four must appear. If `vector` is missing, enable it in the Supabase
dashboard under Database → Extensions before continuing.

---

## Step 1 — Schema

> ⚠️ **This takes an ACCESS EXCLUSIVE lock on `events` and rewrites the table.**
> Adding `search_document` as a `GENERATED ALWAYS AS ... STORED` column is not a
> metadata-only change — Postgres rewrites every row, and **every query against
> `events` blocks until it finishes**. On a live app that is a user-visible
> outage. The GIN and GiST index builds that follow take a SHARE lock, blocking
> writes but not reads.

```bash
psql "$DATABASE_URL" -f backend/src/search/sql/001_search_schema.sql
```

### If you are re-running after the first attempt failed

Two bugs surfaced on first contact with a real database and are now fixed:

1. **`generation expression is not immutable`** — the generated column called
   `array_to_string`, which Postgres marks STABLE. Now routed through an
   `IMMUTABLE` wrapper (`scene_tags_text`, section 2b).
2. **`column "display_name" does not exist`** — see section 3b, which now adds
   it. **Read that section's warning before running:** the column is already
   queried by the pre-existing `GET /users/search` endpoint, so its absence
   means that endpoint is broken in production independently of this work.
   Confirm you're pointed at the database the API actually uses before applying.

The file is `IF NOT EXISTS` throughout and is safe to re-run over the partial
state the first attempt left. The `events` table rewrite has **not** happened yet
— `search_document` was never created — so the ACCESS EXCLUSIVE lock warning
above still applies in full to this run.

### Verify
```sql
-- All four extensions installed
SELECT extname FROM pg_extension WHERE extname IN ('vector','pg_trgm','postgis','unaccent');

-- New columns exist
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_name='events' AND column_name IN ('search_document','embedding','embedded_at','embedding_source');

-- New tables exist
SELECT tablename FROM pg_tables WHERE tablename IN ('neighborhoods','search_logs');

-- The generated column actually populated (should equal your Step 0 count)
SELECT count(*) FROM events WHERE search_document IS NOT NULL;
```

**Expected:** 4 extensions, 4 columns, 2 tables, and `search_document` populated
for every row. A zero on that last query means the generated column didn't
compute — stop, don't continue.

### Abort conditions
- Any statement errors → stop, report the error verbatim. Do not "fix" the DDL.
- The rewrite runs longer than a few minutes on a table you were told was small
  → something is different than expected; investigate before it becomes an
  outage.

---

## Step 2 — Neighborhood dictionary

```bash
psql "$DATABASE_URL" -f backend/src/search/sql/002_seed_neighborhoods.sql
```

### Verify
```sql
-- Expect 36
SELECT count(*) FROM neighborhoods WHERE is_active;

-- Trigram typo tolerance — must return Williamsburg above 0.45
SELECT name, similarity(name, 'willaimsburg') AS sim
  FROM neighborhoods WHERE similarity(name, 'willaimsburg') >= 0.45
 ORDER BY sim DESC;

-- MUST RETURN ZERO ROWS. A duplicate alias makes location parsing
-- non-deterministic — the same query resolves to different places run to run.
SELECT a AS alias, count(*), array_agg(name)
  FROM neighborhoods n, unnest(n.aliases) AS a
 WHERE n.is_active GROUP BY a HAVING count(*) > 1;
```

**Coordinates are approximate centroids written from memory and flagged as such
in the file.** They are close enough for sane radius scoping, but a centroid a
few hundred metres off silently skews every geo-scoped search for that
neighborhood, with no error. Spot-check Bushwick and Williamsburg against a map
before launch.

---

## Step 3 — Embedding backfill

Needs `VOYAGE_API_KEY` (or `EMBEDDING_PROVIDER` plus the matching key).

```bash
cd backend
node src/search/worker/embed-events.js --once --dry-run   # cost estimate, no API calls
node src/search/worker/embed-events.js --once             # drain the queue
```

Report the dry-run cost before spending. At ~130 tokens/event and $0.02/1M it
should be pennies; anything larger means the composed documents are bigger than
expected and is worth understanding first.

### Verify
```sql
SELECT count(*) FILTER (WHERE embedding IS NULL)     AS todo,
       count(*) FILTER (WHERE embedding IS NOT NULL) AS done
  FROM events WHERE status='active';
```

**`todo` must be 0 before Step 4.** Indexing a partial corpus makes the
unembedded events invisible to semantic search until the index is rebuilt.

### Notes
- **The worker refuses to run without a real key**, exiting with an explanation.
  That guard is deliberate: a stub run would fill the column with deterministic
  pseudo-vectors that look valid, index fine, and return meaningless neighbors,
  with nothing raising an error. **Do not work around it.**
- Failed batches are skipped, not fatal — they stay in the queue view and retry
  on the next pass. Re-running `--once` is always safe.
- Events with no title, description, hashtags, or address compose to an empty
  document and are skipped by design. If `todo` won't reach 0, check for those:
  `SELECT count(*) FROM events_needing_embedding;`

---

## Step 4 — HNSW index

Only after `todo` is 0.

```bash
psql "$DATABASE_URL" -f backend/src/search/sql/003_hnsw_index.sql
```

Uses `CREATE INDEX CONCURRENTLY`, so it doesn't block writes — but it **cannot
run inside a transaction block**. If your client wraps statements, run that
statement alone.

### Verify
```sql
-- MUST RETURN ZERO ROWS. A failed CONCURRENTLY build leaves an INVALID index
-- that the planner silently ignores — search just gets slow, with no error.
SELECT c.relname FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
 WHERE c.relname = 'events_embedding_hnsw_idx' AND NOT i.indisvalid;
```

If it returns a row: `DROP INDEX events_embedding_hnsw_idx;` and re-run.

Then confirm the planner actually uses it — look for `Index Scan using
events_embedding_hnsw_idx`, not `Seq Scan`:

```sql
EXPLAIN ANALYZE
SELECT id FROM events WHERE embedding IS NOT NULL
 ORDER BY embedding <=> (SELECT embedding FROM events WHERE embedding IS NOT NULL LIMIT 1)
 LIMIT 10;
```

A `Seq Scan` on a populated table means the operator class doesn't match the
query operator — report it rather than guessing.

---

## Step 5 — End-to-end smoke test

Start the API (`npm run dev` in `backend/`) and hit the endpoint with a real
JWT. Adjust coordinates to a city you actually have events in:

```bash
curl -s -H "Authorization: Bearer $JWT" \
  "http://localhost:3000/api/v1/search?q=techno%20tonight%20in%20bushwick&lat=40.7081&lng=-73.9571&tzOffset=-240" \
  | jq '.meta'
```

### What to check in `meta`
| Field | Expect | If wrong |
|---|---|---|
| `parsed.place.name` | `"Bushwick"` | Step 2 seed didn't take |
| `parsed.time` | non-null | Time parser failed — check `tzOffset` was sent |
| `cleanedQuery` | `"techno"` | Entity stripping broke |
| `counts.lexical` | > 0 | FTS/trigram indexes missing — recheck Step 1 |
| `counts.semantic` | > 0 | Embeddings missing or HNSW invalid |
| `searchId` | non-null uuid | `search_logs` insert failing |
| `retrieverErrors` | `null` | Read the errors — a retriever degraded silently |
| `llmEscalated` | `false` here | Fine either way; `true` means it spent an API call |

Then confirm logging round-trips:
```sql
SELECT id, sanitized_query, cleaned_query, parse_confidence, llm_escalated,
       lexical_count, semantic_count, result_count, latency_ms
  FROM search_logs ORDER BY created_at DESC LIMIT 5;
```

Also try `?q=@<a-real-username>` — should return users, `routeWeights.semantic`
of `0`, and `fallbackApplied: false`.

---

## When you're done

Report back with: the Step 0 event count, the dry-run cost, the final
`todo`/`done` split, and the smoke-test `meta` block. Those four together say
whether this actually works.

**Do not push to `main`** and **do not open a PR unless asked** — CLAUDE.md
requires a PR for every change, but opening one is the developer's call, not
yours. Stay on `claude/scene-search-pipeline-c4wqjj`.

### Known-remaining after this runbook
Not your job unless asked, but so you don't think they were missed: the fixture
DB and relevance harness (17 skipped tests), switching `SearchSheet.jsx` to
`api.search`, deleting the stale `backend/promptfooconfig.yaml`, the tagger
(doesn't exist), a Trust & Safety review of the stage-1 block list, and a
`search_logs` retention policy reconciled with `PRIVACY.md`.
