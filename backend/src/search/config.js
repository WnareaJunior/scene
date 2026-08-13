// Search pipeline tuning constants.
//
// Everything here is a knob the relevance harness measures against. Keep values
// in one place so a Vitest run can import and assert on them rather than
// re-deriving magic numbers, and so tuning is a one-line diff.

module.exports = {
  // ── Stage 1: sanitize ──────────────────────────────────────────────────────
  MAX_QUERY_LENGTH: 200,

  // ── Stage 2: parse ─────────────────────────────────────────────────────────
  // Below this, the rules-based parser is considered unreliable and we spend one
  // LLM call to get structured entities back. Above it, we never call out.
  LLM_ESCALATION_THRESHOLD: 0.55,
  // Trigram similarity floor for resolving `@handle` against users.username.
  USERNAME_MATCH_THRESHOLD: 0.3,
  // Trigram similarity floor for matching a token against the neighborhood /
  // venue dictionary. Higher than the username floor: a false-positive location
  // silently geo-scopes the whole result set, which is worse than missing one.
  LOCATION_MATCH_THRESHOLD: 0.45,

  // ── Stage 3: hard filters ──────────────────────────────────────────────────
  DEFAULT_RADIUS_M: 5000,
  MAX_RADIUS_M: 50000,
  // How far in the past an event may have started and still be considered live.
  // A party that started an hour ago is still a party you can walk into.
  GRACE_PERIOD_MINUTES: 90,

  // ── Stage 4: retrieval ─────────────────────────────────────────────────────
  // Each retriever returns this many candidates; fusion sees both lists in full.
  // Deeper than the page size on purpose — RRF needs tail overlap to work.
  RETRIEVAL_LIMIT: 100,
  // pgvector distance ceiling. Cosine distance, so 0 = identical, 2 = opposite.
  SEMANTIC_MAX_DISTANCE: 0.75,

  // ── Stage 5: fusion ────────────────────────────────────────────────────────
  // RRF dampener. 60 is the value from Cormack et al. 2009 and the de-facto
  // default; it flattens the head enough that a rank-1 hit in one list can't
  // alone beat consistent top-10 presence in both.
  RRF_K: 60,
  // Router weights, selected by parse confidence. A confidently parsed query has
  // had its entities stripped, so what remains is vibe text — lean semantic. A
  // low-confidence query is probably a literal name or handle — lean lexical.
  ROUTER_WEIGHTS: {
    highConfidence: { lexical: 0.35, semantic: 0.65 },
    balanced: { lexical: 0.5, semantic: 0.5 },
    lowConfidence: { lexical: 0.75, semantic: 0.25 },
    // Exact-ish signals bypass the router entirely.
    usernameLookup: { lexical: 1.0, semantic: 0.0 },
    quoted: { lexical: 0.9, semantic: 0.1 },
  },

  // ── Stage 6: re-rank ───────────────────────────────────────────────────────
  // Weights applied to normalized [0,1] signals, then blended with the fusion
  // score. Must sum to 1.0 — asserted in the test harness.
  RERANK_WEIGHTS: {
    fusion: 0.55,
    rsvpVelocity: 0.15,
    tagAffinity: 0.12,
    recency: 0.08,
    distanceDecay: 0.10,
  },
  // Distance at which the decay term has fallen to 0.5.
  DISTANCE_HALF_LIFE_M: 3000,
  // Window for "RSVPs per hour since publish" — beyond this, velocity is stale.
  VELOCITY_WINDOW_HOURS: 48,

  // ── Stage 7: fallback ──────────────────────────────────────────────────────
  // Result count below which we consider the search to have failed and relax.
  WEAK_RESULT_THRESHOLD: 3,
  // One retry only, per the pipeline spec. The ladder is applied all at once on
  // that single retry, not stepped — a second round trip costs more than it
  // recovers.
  FALLBACK_RADIUS_MULTIPLIER: 4,
  FALLBACK_TIME_WINDOW_DAYS: 30,

  // ── Stage 8: logging ───────────────────────────────────────────────────────
  // Logging is fire-and-forget; this bounds how long a failed insert can hold a
  // pool connection.
  LOG_TIMEOUT_MS: 2000,

  // ── Embeddings ─────────────────────────────────────────────────────────────
  // Must match the vector(N) width in sql/001_search_schema.sql. Changing this
  // requires a re-embed and an index rebuild.
  EMBEDDING_DIM: 1024,
};
