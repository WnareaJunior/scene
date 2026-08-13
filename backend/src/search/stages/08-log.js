// Stage 8 — Log.
//
// Writes one row per search into `search_logs`, plus one update per tap. This is
// the training data for everything that comes later — learned routing weights, a
// learned re-ranker, offline relevance evaluation — so the schema errs toward
// recording more than is currently used.
//
// Two hard rules:
//   1. Never block the response. Logging is fire-and-forget with a timeout; a
//      logging failure must never turn a good search into a 500.
//   2. Never log the raw query verbatim without the sanitized form alongside it.
//      Stage 1's rejections are exactly the rows an abuse review needs to see,
//      and the normalized text is what the pipeline actually acted on.

const { LOG_TIMEOUT_MS } = require('../config');

/**
 * Trim the result set down to what's worth persisting. Storing full rows would
 * balloon the table; ids plus per-result diagnostics are enough to reconstruct
 * ranking decisions offline.
 * @param {object[]} results
 * @param {number} [cap]
 */
function summarizeResults(results, cap = 20) {
  return results.slice(0, cap).map((r, i) => ({
    id: r.id,
    position: i + 1,
    finalScore: Number(r.finalScore?.toFixed(6)),
    fusionScore: Number(r.fusionScore?.toFixed(6)),
    lexicalRank: r.sources?.lexical?.rank ?? null,
    semanticRank: r.sources?.semantic?.rank ?? null,
  }));
}

/**
 * Record a search. Fire-and-forget: returns the log id when the insert lands in
 * time, null otherwise. Callers must not await this on the response path.
 *
 * @param {{query: Function}} db
 * @param {object} entry
 * @returns {Promise<string|null>}
 */
async function logSearch(db, entry) {
  const insert = db.query(
    `INSERT INTO search_logs (
       user_id, raw_query, sanitized_query, cleaned_query,
       rejected, rejection_reason, sanitize_flags,
       parsed_entities, parse_confidence, llm_escalated,
       applied_filters, route_weights,
       lexical_count, semantic_count, fused_count,
       results_shown, result_count,
       fallback_applied, retriever_errors, latency_ms
     ) VALUES (
       $1, $2, $3, $4,
       $5, $6, $7,
       $8, $9, $10,
       $11, $12,
       $13, $14, $15,
       $16, $17,
       $18, $19, $20
     )
     RETURNING id`,
    [
      entry.userId,
      entry.rawQuery,
      entry.sanitizedQuery,
      entry.cleanedQuery,
      entry.rejected,
      entry.rejectionReason,
      entry.sanitizeFlags || [],
      JSON.stringify(entry.parsedEntities ?? null),
      entry.parseConfidence,
      entry.llmEscalated,
      JSON.stringify(entry.appliedFilters ?? null),
      JSON.stringify(entry.routeWeights ?? null),
      entry.lexicalCount,
      entry.semanticCount,
      entry.fusedCount,
      JSON.stringify(entry.resultsShown ?? []),
      entry.resultCount,
      entry.fallbackApplied,
      JSON.stringify(entry.retrieverErrors ?? null),
      entry.latencyMs,
    ]
  );

  const timeout = new Promise(resolve => setTimeout(() => resolve(null), LOG_TIMEOUT_MS));

  try {
    const result = await Promise.race([insert, timeout]);
    return result?.rows?.[0]?.id ?? null;
  } catch (err) {
    // Swallow deliberately — see rule 1 above. Surfaced to stderr so a broken
    // logging table is still visible in Render's logs.
    console.error('search log insert failed:', err.message);
    return null;
  }
}

/**
 * Record which result the user tapped. Called from the client via
 * POST /api/v1/search/:searchId/tap.
 *
 * Position matters as much as the id: it's what makes the log usable as click
 * data, since a tap at position 1 and a tap at position 12 carry very different
 * relevance signal.
 *
 * @param {{query: Function}} db
 * @param {object} tap
 * @returns {Promise<boolean>} false when the log row doesn't exist or isn't the caller's
 */
async function logTap(db, { searchId, userId, resultId, resultType, position }) {
  try {
    const { rowCount } = await db.query(
      `UPDATE search_logs
       SET tapped_result_id = $3,
           tapped_result_type = $4,
           tapped_position = $5,
           tapped_at = now()
       WHERE id = $1 AND user_id = $2`,
      [searchId, userId, resultId, resultType, position]
    );
    return rowCount > 0;
  } catch (err) {
    console.error('search tap log failed:', err.message);
    return false;
  }
}

module.exports = { logSearch, logTap, summarizeResults };
