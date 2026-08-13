# Search pipeline deployment — COMPLETE on prod DB (2026-08-12)

_Branch: `claude/scene-search-pipeline-c4wqjj`. All runbook steps 0–5 done and
verified against production Supabase. Search is NOT publicly live yet — see
"remaining" below._

## Final state

| Runbook step | Result |
|---|---|
| Step 0 — size | 65 active events (post lorem-purge, was 213) |
| Step 3 — embeddings | ✅ 65/65, ~2,866 tokens, ~$0.0001 (Voyage, payment method added → standard rate limits) |
| Step 4 — HNSW | ✅ index valid, planner uses it (verified with enable_seqscan=off; plain EXPLAIN prefers seq scan at this corpus size — expected) |
| Step 5 — smoke | ✅ "techno tonight in bushwick": place=Bushwick exact, conf 0.95, lex 2 + sem 5, no retriever errors, 493ms, topical results. Semantic-only query → 16 results. @handle lookup ✅. search_logs round-trips ✅ |

## Prod data changes this session (all approved by Wilson)

- Deleted 170 lorem/faker events (hosts = batch-created accounts from
  2026-06-03 / 07-20 / 08-07 load tests; identified by Latin-only descriptions,
  scene-seed.app and example.com hosts explicitly protected).
- Cloned the 22 good `@example.com`-hosted public events forward into the next
  ~3 weeks (same venues/hosts, future dates). Active now: 65 (40 upcoming).
- Deleted accidental `stagingsmoke@test.dev` user (created via a stale
  port-3000 dev server that was still on prod config — killed) and the
  temporary `smoketest@scene-seed.app` smoke user.
- The bulk1.*/faker **user accounts still exist** (only their events deleted).

## Update 2026-08-13 — search is LIVE on prod

1. ~~Merge pipeline branch~~ — PR #57 merged, deployed to Render.
2. ~~Render env~~ — `SEARCH_ENABLED=true` + `VOYAGE_API_KEY` set; authed smoke
   against the live service passed (Harlem jazz query: conf 0.95, 14 fused).
3. SearchSheet cutover → PR #59; iOS preview build `b0143067` ships it.
4. Auto-embed → PR #60 adds an in-process 5-min sweep (`EMBED_SWEEP_MS`).
   Until #60 deploys, new prod events need a manual `embed-events.js --once`.

Also 2026-08-13: +200 seeded events per env (`scripts/seed-nyc-events.js`,
all boroughs, embedded). Bench (`src/search/bench/run-bench.js`) on prod:
29/29 · hit@10 100% · MRR 0.888 · p50 278ms · p95 582ms. Known relevance gap
(caught by bench): exact keyword matches beyond the viewport radius lose to
in-radius semantic results and the fallback never widens — candidate fix is
per-retriever-emptiness fallback.

## Environment notes

- Staging (`scene-staging`, ref rpjnkjoyxeykqlppwfkp) has the identical stack
  incl. HNSW — full rehearsal passed there first. `backend/.env` = staging,
  `.env.production` = prod (has VOYAGE_API_KEY now).
- Prod psql wrapper (classifier-approved): `$CLAUDE_JOB_DIR/tmp/db.sh` —
  job-scoped, recreate from the recipe in backend/README.md env section if gone.
- Prod DB password still unrotated and still not URL-parseable (raw `%`).
