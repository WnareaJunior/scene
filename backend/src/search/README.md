# Search pipeline

Eight stages behind `GET /api/v1/search`. Two external dependencies total — one
embedding API, one LLM API — and both degrade to a working search when down.

```
 ①  sanitize ──▶ ②  parse ──▶ ③  filters ──▶ ④  retrieve ──▶ ⑤  fuse ──▶ ⑥  rerank
    pure code      rules,          time +        lexical ∥       RRF +       velocity,
    can reject     LLM only        PostGIS       semantic        router      affinity,
                   on escalation                                             recency,
                        │                                                    distance
                        │                            ┌──────────────────────────┘
                        │                            ▼
                        └──────────────────  ⑦  fallback (once) ──▶ ⑧  log
```

## Layout

| Path | Stage | Notes |
|---|---|---|
| `stages/01-sanitize.js` | 1 | Only stage that can terminate the pipeline |
| `stages/02-parse.js` | 2 | Composes the three extractors, decides escalation |
| `parse/time.js` | 2a | Rules table + optional `chrono-node` |
| `parse/location.js` | 2b | `neighborhoods` dictionary, cached 10 min |
| `parse/username.js` | 2c | `@` detection + trigram resolve |
| `stages/03-filters.js` | 3 | Parameterized builder — no `$n` hand-counting |
| `stages/04-retrieve.js` | 4 | Both retrievers, `Promise.allSettled` |
| `stages/05-fuse.js` | 5 | RRF + router weights |
| `stages/06-rerank.js` | 6 | Four normalized signals |
| `index.js` | 7 | Fallback is control flow over 3–6, not a step |
| `stages/08-log.js` | 8 | Fire-and-forget writes to `search_logs` |
| `adapters/llm.js` | — | Anthropic / OpenAI / stub |
| `adapters/embeddings.js` | — | Voyage / OpenAI / stub |
| `sql/001_search_schema.sql` | — | **Not auto-applied.** Run by hand. |

## Setup

**1. Apply the DDL.** `sql/001_search_schema.sql` is reviewable, idempotent, and
nothing in the codebase executes it. Run it against Supabase yourself, in
section order — the HNSW index at the end must be built *after* embeddings are
backfilled, or the build is dramatically slower.

**2. Seed `neighborhoods`.** Stage 2b returns "no location" against an empty
dictionary, which is correct but means every query searches the whole viewport.

**3. Backfill embeddings.** `events_needing_embedding` is the work queue. The
worker that drains it is *not* scaffolded — it wants a queue and a retry policy,
and the batch size depends on your provider's rate limit.

**4. Set the env vars** (all optional — absent means stub):

```
LLM_PROVIDER=anthropic          # anthropic | openai | stub
ANTHROPIC_API_KEY=...
LLM_MODEL=claude-haiku-4-5-20251001
LLM_TIMEOUT_MS=2500

EMBEDDING_PROVIDER=voyage       # voyage | openai | stub
VOYAGE_API_KEY=...
EMBEDDING_MODEL=voyage-3
```

With no keys set, both adapters run in stub mode and the whole pipeline works
end to end — the semantic path returns deterministic pseudo-vectors. Good enough
to prove wiring, useless for relevance. **Do not assert recall@5 or MRR against
the stub.**

## Tests

```
node --test src/search/__tests__/pipeline.test.js
```

32 passing, 17 skipped. The skips all need the Dockerized
PostGIS+pgvector+pg_trgm fixture DB; they're listed explicitly so the gap stays
visible. Pure-code stages (1, 2a, 5, 6) are covered for real — they're
deterministic given an injected `now`.

These are `node:test` + `node:assert` so they run with zero new dependencies.
Porting to Vitest is a near-identical rename (`test` → `it`); it isn't wired up
because that means editing `backend/package.json`, which the agent scope rules in
`CLAUDE.md` put off-limits.

The LLM parser is covered separately by `backend/promptfooconfig.yaml`, in
isolation from the pipeline. That config currently targets `ollama:llama3.2` and
tests prose generation — it needs rewriting against the real parser contract
(`PARSE_SCHEMA` in `adapters/llm.js`) before it means anything.

## Design decisions worth knowing

**RRF consumes rank, never score.** `ts_rank_cd` is an unbounded float scaled by
document length; cosine similarity is bounded `[-1,1]`. There is no principled
normalization between them. Ranks are commensurable by construction.

**Both retrievers share stage 3's filter verbatim.** That identity is what makes
fusion valid — fusing lists drawn from different populations lets a document
rank highly in one purely because the other never saw it.

**Entities are stripped before retrieval.** `"techno tonight in bushwick"` embeds
as `"techno"`. Time and place are already hard filters; leaving them in the text
makes every event in Bushwick look semantically similar regardless of genre.

**The rules parser wins ties against the LLM.** The LLM only fills gaps. Rules
are deterministic and testable; the model is neither.

**Stage 1's injection flag doesn't reject.** A suspicious query still gets
searched — it just never reaches an LLM. Rejecting would break legitimate
searches that happen to contain the trigger words.

**The fallback retries exactly once**, relaxing radius and time together rather
than stepping a ladder, and the retry is discarded unless it actually returned
more. It never touches the visibility clauses — no amount of "no results"
justifies surfacing a private party.

**A failing retriever degrades, never errors.** If the embedding provider is
down, lexical-only search is a fine degraded mode. Stage 5 reassigns the dead
weight so a missing retriever doesn't flatten the survivor's scores.

## Known gaps

- **Embedding worker** — the queue view exists, the worker doesn't.
- **`neighborhoods` seed data** — table defined, empty.
- **Fixture DB + relevance harness** — 17 skipped tests describe the contract.
- **`promptfooconfig.yaml`** — still tests the old prose prompts.
- **Block list in stage 1** — narrow by design; confirm with Trust & Safety
  before launch. False positives read to the user as "search is broken".
- **`search_logs` retention** — holds raw user queries. Pick a window and
  reconcile with `PRIVACY.md` and the account-deletion flow before prod traffic.
- **`SearchSheet.jsx` is not switched over.** `api.search` is wired up; the sheet
  still uses the old two-call path.
