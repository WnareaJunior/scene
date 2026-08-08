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
EMBEDDING_MODEL=voyage-4-lite
```

With no keys set, both adapters run in stub mode and the whole pipeline works
end to end — the semantic path returns deterministic pseudo-vectors. Good enough
to prove wiring, useless for relevance. **Do not assert recall@5 or MRR against
the stub.**

## Cost

Two paid calls, and they are not close to equal.

| Component | When it fires | Cost per 1k searches |
|---|---|---|
| Query embedding (voyage-4-lite, $0.02/1M) | Every non-`@handle` search | **~$0.0003** |
| LLM parse (claude-haiku-4-5, $1/$5 per 1M) | Only below `LLM_ESCALATION_THRESHOLD` | **~$0.0009 × escalation rate** |
| Event embedding | Once per event, plus edits | ~$0.0000026/event |

At a 25% escalation rate the parse is roughly **700× the cost of query
embeddings**. Embeddings are effectively free — Voyage's 200M-token free tier
covers ~1.5M events plus millions of queries. Escalation rate is the only number
that matters.

**Prompt caching does not apply to the parser.** The minimum cacheable prefix on
Haiku 4.5 is 4096 tokens; system prompt + tool schema + query is ~470. It would
silently not cache (`cache_creation_input_tokens: 0`, no error). Don't add
`cache_control` here expecting a discount.

**The Batch API does not apply either** — 50% off, but up to 24h turnaround
against a 300ms search path. It *is* the right tool for a one-off tag backfill
or an offline eval sweep.

The real lever is **caching parse results by normalized query**, not model
choice: search traffic has a heavy head, and `search_logs` already records
`sanitized_query` and `parse_confidence` to size it. Before paying anything, run
with `LLM_PROVIDER=stub` and query the logs — stage 8 records
`parse_confidence` and `llm_escalated` on every row, so the escalation rate
comes from real traffic rather than a guess:

```sql
SELECT count(*) FILTER (WHERE parse_confidence < 0.55)::float / count(*) AS escalation_rate,
       count(DISTINCT sanitized_query)::float / count(*)                  AS distinct_ratio
FROM search_logs WHERE rejected = false;
```

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

The LLM parser is covered separately, in isolation from the pipeline:

```
npx promptfoo@latest eval -c backend/src/search/eval/promptfooconfig.yaml
```

That config replaces `backend/promptfooconfig.yaml`, which tested prose
generation against `ollama:llama3.2` — a behavior the pipeline never invokes,
against a provider it never calls. It passed while testing nothing, which
matters because CLAUDE.md gates PRs touching AI logic on a promptfoo run.

The eval shares `parse-tool.json` and `parse-prompt.json` with the running
adapter, and three tests in `pipeline.test.js` assert they stay identical to
`PARSE_SCHEMA` and `SYSTEM_PROMPT`. That closes the drift hole that let the old
config rot unnoticed. Cases are grouped by failure mode: null discipline (a
hallucinated location becomes a hard geo filter), extraction correctness,
relative-time resolution against the user's timezone, prompt injection, and
degenerate input.

The old config at `backend/promptfooconfig.yaml` is still on disk — deleting it
is outside the agent scope in CLAUDE.md, and leaving both invites running the
wrong one.

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
