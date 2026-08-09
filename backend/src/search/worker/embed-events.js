#!/usr/bin/env node
//
// Embedding worker — drains `events_needing_embedding` (blocker #3).
//
//   node src/search/worker/embed-events.js --once          # one pass, then exit
//   node src/search/worker/embed-events.js --loop          # poll forever
//   node src/search/worker/embed-events.js --once --dry-run # cost estimate only
//
// Deliberately a drainable queue rather than a cron loop. The view is the queue:
// it returns every active event whose stored `embedding_source` differs from the
// document its current columns compose to, so an edited event re-enters the
// queue automatically and a finished event drops out. Nothing else tracks state.
//
// ── Why there is no locking ──────────────────────────────────────────────────
// Two workers can claim the same row. That is fine and intentional: the write is
// idempotent (same input, same vector) and the loser's write is identical to the
// winner's. Adding SKIP LOCKED would buy nothing and cost a transaction per
// batch. The one real race — an event edited between our read and our write — is
// self-correcting: we store the source we actually embedded, so the view sees a
// mismatch against the new columns on the next pass and hands the row back.
//
// ── Failure policy ───────────────────────────────────────────────────────────
// A batch that fails after its retries is skipped, not fatal. Those rows stay in
// the view and come back next pass. A worker that dies mid-run loses nothing —
// there is no partial state to reconcile.

require('dotenv').config();

const db = require('../../db');
const { embed, toPgVector, provider, isStub } = require('../adapters/embeddings');

// ── Tuning ───────────────────────────────────────────────────────────────────
// Voyage accepts up to 128 inputs per request; staying under it leaves headroom
// for the token cap, which bites first on events with long descriptions.
const BATCH_SIZE = Number(process.env.EMBED_BATCH_SIZE) || 64;
// Rows fetched per pass. Bounded so a cold backfill of 100k events doesn't pull
// the whole table into memory.
const PAGE_SIZE = Number(process.env.EMBED_PAGE_SIZE) || 512;
const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 1000;
// Pause between batches. The default provider tier allows far more than this;
// it exists so a backfill doesn't monopolize the rate limit and starve the live
// query-embedding path, which shares the same quota.
const INTER_BATCH_MS = Number(process.env.EMBED_THROTTLE_MS) || 200;
// Idle poll interval in --loop mode.
const IDLE_POLL_MS = Number(process.env.EMBED_POLL_MS) || 30_000;

// Rough $/1M tokens for the default provider, used only for the log line.
const PRICE_PER_MTOK = Number(process.env.EMBED_PRICE_PER_MTOK) || 0.02;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Cheap token estimate for logging and dry runs. Not exact — we don't ship a
 * tokenizer for this — but the right order of magnitude for a cost line.
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

/**
 * Fetch the next page of work.
 * @param {number} limit
 * @returns {Promise<{id: string, source: string}[]>}
 */
async function claimBatch(limit) {
  const { rows } = await db.query(
    `SELECT id, source FROM events_needing_embedding LIMIT $1`,
    [limit]
  );
  // An event with no title, description, hashtags, or address composes to an
  // empty document. Embedding "" wastes a call and stores a meaningless vector,
  // so skip it — the row stays in the view until it has content.
  return rows.filter(r => r.source && r.source.trim());
}

/**
 * Retry wrapper. Retries on rate limits and transient upstream failures; gives
 * up immediately on anything that looks like a bad request, since retrying a
 * malformed payload just burns quota.
 * @param {() => Promise<T>} fn
 * @param {string} label
 * @returns {Promise<T>}
 * @template T
 */
async function withRetry(fn, label) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = String(err.message || '');
      const retryable = /\b(429|500|502|503|504)\b/.test(msg) || /timeout|ECONN|socket|fetch failed/i.test(msg);
      if (!retryable || attempt === MAX_RETRIES) break;
      // Exponential backoff with full jitter — a fleet of workers hitting the
      // same 429 must not retry in lockstep.
      const backoff = Math.round(Math.random() * BASE_BACKOFF_MS * 2 ** attempt);
      console.warn(`[embed] ${label} attempt ${attempt + 1} failed (${msg.slice(0, 120)}); retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

/**
 * Embed one batch and write the vectors back.
 * @param {{id: string, source: string}[]} batch
 * @returns {Promise<number>} rows written
 */
async function processBatch(batch) {
  const vectors = await withRetry(
    () => embed(batch.map(r => r.source), { inputType: 'document' }),
    `batch of ${batch.length}`
  );

  if (!Array.isArray(vectors) || vectors.length !== batch.length) {
    throw new Error(`provider returned ${vectors?.length} vectors for ${batch.length} inputs`);
  }

  // One statement per batch via unnest, rather than N round trips. `embedded_at`
  // is set from the DB clock, not the worker's — a worker with a skewed clock
  // would otherwise write timestamps that break freshness comparisons.
  const { rowCount } = await db.query(
    `UPDATE events e
        SET embedding        = v.embedding::vector,
            embedding_source = v.source,
            embedded_at      = now()
       FROM (
         SELECT unnest($1::uuid[])   AS id,
                unnest($2::text[])   AS embedding,
                unnest($3::text[])   AS source
       ) AS v
      WHERE e.id = v.id`,
    [
      batch.map(r => r.id),
      vectors.map(toPgVector),
      batch.map(r => r.source),
    ]
  );

  return rowCount;
}

/**
 * One full drain pass.
 * @param {{dryRun: boolean}} opts
 * @returns {Promise<{written: number, failed: number, tokens: number}>}
 */
async function drain({ dryRun }) {
  let written = 0;
  let failed = 0;
  let tokens = 0;

  for (;;) {
    const page = await claimBatch(PAGE_SIZE);
    if (!page.length) break;

    for (let i = 0; i < page.length; i += BATCH_SIZE) {
      const batch = page.slice(i, i + BATCH_SIZE);
      tokens += batch.reduce((acc, r) => acc + estimateTokens(r.source), 0);

      if (dryRun) {
        written += batch.length;
        continue;
      }

      try {
        written += await processBatch(batch);
      } catch (err) {
        // Skip, don't abort. The rows stay in the view and retry next pass.
        failed += batch.length;
        console.error(`[embed] batch failed permanently, leaving for next pass: ${err.message}`);
      }

      if (INTER_BATCH_MS) await sleep(INTER_BATCH_MS);
    }

    // A page that produced nothing but failures would otherwise spin forever on
    // the same rows — the view still returns them, so the next claimBatch is
    // identical. Bail out and let the next scheduled pass try again.
    if (!dryRun && failed >= page.length) {
      console.error('[embed] entire page failed; stopping this pass');
      break;
    }

    // A short page means the queue is drained.
    if (page.length < PAGE_SIZE) break;
  }

  return { written, failed, tokens };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const loop = args.has('--loop');
  const dryRun = args.has('--dry-run');

  if (isStub && !dryRun) {
    console.error(
      '[embed] EMBEDDING_PROVIDER resolves to "stub" — no API key is configured.\n' +
      '        Refusing to run: this would fill the embedding column with\n' +
      '        deterministic pseudo-vectors that look valid, index fine, and\n' +
      '        return meaningless neighbors. Set VOYAGE_API_KEY (or\n' +
      '        EMBEDDING_PROVIDER + the matching key), or pass --dry-run.'
    );
    process.exit(1);
  }

  console.log(`[embed] provider=${provider} batch=${BATCH_SIZE} ${dryRun ? '(DRY RUN — no writes, no API calls)' : ''}`);

  do {
    const started = Date.now();
    const { written, failed, tokens } = await drain({ dryRun });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const cost = (tokens / 1e6) * PRICE_PER_MTOK;

    if (written || failed) {
      console.log(
        `[embed] ${dryRun ? 'would embed' : 'embedded'} ${written} events in ${secs}s` +
        `${failed ? `, ${failed} failed (will retry next pass)` : ''}` +
        ` · ~${tokens.toLocaleString()} tokens · ~$${cost.toFixed(4)}`
      );
    } else {
      console.log('[embed] queue empty');
    }

    if (loop) await sleep(IDLE_POLL_MS);
  } while (loop);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[embed] fatal:', err.message);
      process.exit(1);
    });
}

module.exports = { drain, processBatch, claimBatch, estimateTokens, withRetry };
