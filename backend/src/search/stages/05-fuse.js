// Stage 5 — Rank fusion.
//
// Reciprocal Rank Fusion over the two stage-4 lists. Pure code, no I/O.
//
//   score(d) = Σ_lists  weight_list / (K + rank_list(d))
//
// RRF consumes rank, never score. That's the point: ts_rank_cd returns an
// unbounded float whose scale depends on document length, cosine similarity is
// bounded [-1,1], and there is no principled normalization between them. Ranks
// are commensurable by construction.
//
// The router decides the weights instead of picking one retriever. A query we
// parsed confidently has had its entities stripped, so what's left is vibe text
// — semantic should lead. A query we barely parsed is probably a literal name or
// hashtag — lexical should lead. Both lists always contribute; the weights only
// change how loudly.

const { RRF_K, ROUTER_WEIGHTS, LLM_ESCALATION_THRESHOLD } = require('../config');

/**
 * Choose lexical/semantic weights from what stage 2 understood.
 *
 * @param {import('./02-parse').ParseResult} parsed
 * @param {string} rawText Sanitized (pre-strip) query, for quote detection
 * @returns {{lexical: number, semantic: number, reason: string}}
 */
function route(parsed, rawText) {
  // Explicit handle lookup — there is no vibe to embed. Skip semantic entirely.
  if (parsed.entities.usernameExplicit) {
    return { ...ROUTER_WEIGHTS.usernameLookup, reason: 'username_lookup' };
  }

  // Quoted phrase — the user is asking for a literal string. Honor it.
  if (/"[^"]{2,}"/.test(rawText)) {
    return { ...ROUTER_WEIGHTS.quoted, reason: 'quoted_phrase' };
  }

  // A bare hashtag is a literal token, not a concept.
  if (/^#?[a-z0-9_]+$/i.test(parsed.cleanedText || '') && (parsed.cleanedText || '').length <= 20) {
    return { ...ROUTER_WEIGHTS.lowConfidence, reason: 'single_token' };
  }

  if (parsed.confidence >= 0.8) {
    return { ...ROUTER_WEIGHTS.highConfidence, reason: 'high_confidence_parse' };
  }
  if (parsed.confidence >= LLM_ESCALATION_THRESHOLD) {
    return { ...ROUTER_WEIGHTS.balanced, reason: 'balanced' };
  }
  return { ...ROUTER_WEIGHTS.lowConfidence, reason: 'low_confidence_parse' };
}

/**
 * Weighted Reciprocal Rank Fusion.
 *
 * @param {{list: {id: string, rank: number, row: object}[], weight: number, name: string}[]} inputs
 * @param {number} [k]
 * @returns {{id: string, row: object, fusionScore: number, sources: object}[]} descending by score
 */
function reciprocalRankFusion(inputs, k = RRF_K) {
  /** @type {Map<string, {id: string, row: object, fusionScore: number, sources: object}>} */
  const merged = new Map();

  for (const { list, weight, name } of inputs) {
    if (!weight || !list?.length) continue;
    for (const item of list) {
      const contribution = weight / (k + item.rank);
      const existing = merged.get(item.id);
      if (existing) {
        existing.fusionScore += contribution;
        existing.sources[name] = { rank: item.rank, score: item.score, contribution };
        // Rows from the two retrievers carry identical columns; keep the first
        // one seen rather than merging, to avoid a partial row winning.
      } else {
        merged.set(item.id, {
          id: item.id,
          row: item.row,
          fusionScore: contribution,
          sources: { [name]: { rank: item.rank, score: item.score, contribution } },
        });
      }
    }
  }

  return [...merged.values()].sort((a, b) => b.fusionScore - a.fusionScore);
}

/**
 * Stage 5 entry point.
 *
 * @param {{lexical: object[], semantic: object[]}} retrieved
 * @param {import('./02-parse').ParseResult} parsed
 * @param {string} rawText
 * @returns {{results: object[], weights: object}}
 */
function fuse(retrieved, parsed, rawText) {
  const weights = route(parsed, rawText);

  // If one retriever came back empty — provider outage, no embeddings yet, an
  // empty tsquery — its weight is dead mass that would flatten the surviving
  // list's scores. Reassign it so a degraded retriever doesn't degrade ranking.
  const effective = { ...weights };
  if (!retrieved.semantic.length && retrieved.lexical.length) {
    effective.lexical = 1;
    effective.semantic = 0;
    effective.reason = `${weights.reason}+semantic_empty`;
  } else if (!retrieved.lexical.length && retrieved.semantic.length) {
    effective.lexical = 0;
    effective.semantic = 1;
    effective.reason = `${weights.reason}+lexical_empty`;
  }

  const results = reciprocalRankFusion([
    { list: retrieved.lexical, weight: effective.lexical, name: 'lexical' },
    { list: retrieved.semantic, weight: effective.semantic, name: 'semantic' },
  ]);

  return { results, weights: effective };
}

module.exports = { fuse, route, reciprocalRankFusion };
