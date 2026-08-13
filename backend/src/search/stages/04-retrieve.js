// Stage 4 — Parallel retrieval.
//
// Two independent retrievers over the same stage-3 candidate pool, run
// concurrently. Neither knows about the other; fusion in stage 5 is what
// reconciles them.
//
//   Lexical  — Postgres FTS (websearch_to_tsquery over the generated
//              search_document tsvector) OR'd with pg_trgm similarity on title.
//              FTS catches "warehouse rave"; trigram catches "warehosue".
//   Semantic — pgvector cosine distance against the HNSW index on the composed
//              document embedding (title + description + hashtags).
//
// Both return a uniform {id, rank, score} shape. Rank is 1-based and dense —
// RRF consumes rank, not score, precisely so the two incomparable score scales
// (ts_rank_cd's unbounded float vs. cosine distance) never need reconciling.
//
// A retriever that throws returns an empty list rather than failing the request.
// If the embedding provider is down, lexical-only search is a perfectly good
// degraded mode; failing the whole query is not.

const { RETRIEVAL_LIMIT, SEMANTIC_MAX_DISTANCE } = require('../config');
const { embedQuery, toPgVector } = require('../adapters/embeddings');
const { FilterBuilder } = require('./03-filters');

// Columns every retriever returns, so stage 6 has what it needs to re-rank
// without a second round trip.
const EVENT_COLUMNS = `
        e.id, e.title, e.description, e.latitude, e.longitude, e.address,
        e.start_time, e.end_time, e.capacity, e.hashtags, e.show_attendees,
        e.host_id, e.image_url, e.created_at,
        u.username AS host_username, u.profile_picture AS host_picture`;

// Aggregates stage 6 needs: RSVP counts drive velocity, the viewer's own RSVP
// is returned for UI parity with GET /events.
const EVENT_AGGREGATES = `
        (SELECT count(*) FROM rsvps r WHERE r.event_id = e.id AND r.status = 'going') AS going_count,
        (SELECT count(*) FROM rsvps r WHERE r.event_id = e.id AND r.status = 'interested') AS interested_count,
        (SELECT count(*) FROM rsvps r
          WHERE r.event_id = e.id
            AND r.created_at >= now() - ($RECENT_WINDOW)::interval) AS recent_rsvp_count,
        (SELECT status FROM rsvps r WHERE r.event_id = e.id AND r.user_id = $VIEWER) AS user_rsvp`;

/**
 * Substitute the aggregate template's placeholders.
 *
 * Uses function replacements deliberately: bind() returns strings like `$12`,
 * and `$1` in a plain string replacement is a capture-group reference, which
 * would silently mangle any placeholder past $9.
 *
 * @param {string} viewer Placeholder for the viewer id
 * @param {string} recentWindow Placeholder for the velocity interval
 * @returns {string}
 */
function renderAggregates(viewer, recentWindow) {
  return EVENT_AGGREGATES
    .replace('$RECENT_WINDOW', () => recentWindow)
    .replace('$VIEWER', () => viewer);
}

/**
 * Attach dense 1-based ranks to an ordered row set.
 * @param {object[]} rows Already ordered best-first
 * @param {(row: object) => number} scoreOf
 * @returns {{id: string, rank: number, score: number, row: object}[]}
 */
function rankRows(rows, scoreOf) {
  return rows.map((row, i) => ({ id: row.id, rank: i + 1, score: scoreOf(row), row }));
}

/**
 * Lexical retrieval: full-text + trigram, unioned.
 *
 * websearch_to_tsquery (not plainto_tsquery) so quoted phrases and `-exclusion`
 * work the way users expect from every other search box they use. It also never
 * throws on malformed input, which plainto_tsquery does.
 *
 * @param {object} ctx
 * @param {{query: Function}} ctx.db
 * @param {string} ctx.text Cleaned query text
 * @param {object} ctx.filters Result of buildEventFilters
 * @param {string} ctx.userId
 * @param {number} [ctx.limit]
 * @returns {Promise<{id: string, rank: number, score: number, row: object}[]>}
 */
async function retrieveLexical({ db, text, filters, userId, limit = RETRIEVAL_LIMIT }) {
  if (!text?.trim()) return [];

  const builder = new FilterBuilder(filters.params);
  const q = builder.bind(text);
  const viewer = builder.bind(userId);
  const recentWindow = builder.bind('48 hours');
  const lim = builder.bind(limit);

  const aggregates = renderAggregates(viewer, recentWindow);

  const { rows } = await db.query(
    `WITH scored AS (
       SELECT ${EVENT_COLUMNS},
              ${aggregates},
              ts_rank_cd(e.search_document, websearch_to_tsquery('english', ${q})) AS fts_score,
              similarity(e.title, ${q}) AS trgm_score
       FROM events e
       JOIN users u ON u.id = e.host_id
       WHERE ${filters.where}
         AND (
           e.search_document @@ websearch_to_tsquery('english', ${q})
           OR e.title % ${q}
         )
     )
     SELECT *,
            -- Weighted blend, not a max: an event matching both signals should
            -- outrank one that only spikes on trigram noise.
            (fts_score * 0.7 + trgm_score * 0.3) AS lexical_score
     FROM scored
     ORDER BY lexical_score DESC, start_time ASC
     LIMIT ${lim}`,
    builder.params
  );

  return rankRows(rows, r => Number(r.lexical_score) || 0);
}

/**
 * Semantic retrieval: HNSW cosine-distance nearest neighbors.
 *
 * The distance ceiling is applied *after* the ORDER BY ... LIMIT rather than as
 * a WHERE predicate, because a pre-filter on distance defeats the HNSW index and
 * degrades to a sequential scan over every embedded event.
 *
 * @param {object} ctx
 * @returns {Promise<{id: string, rank: number, score: number, row: object}[]>}
 */
async function retrieveSemantic({ db, text, filters, userId, limit = RETRIEVAL_LIMIT }) {
  if (!text?.trim()) return [];

  const vector = await embedQuery(text);
  if (!vector?.length) return [];

  const builder = new FilterBuilder(filters.params);
  const vec = builder.bind(toPgVector(vector));
  const viewer = builder.bind(userId);
  const recentWindow = builder.bind('48 hours');
  const lim = builder.bind(limit);
  const maxDistance = builder.bind(SEMANTIC_MAX_DISTANCE);

  const aggregates = renderAggregates(viewer, recentWindow);

  const { rows } = await db.query(
    `WITH neighbors AS (
       SELECT ${EVENT_COLUMNS},
              ${aggregates},
              e.embedding <=> ${vec}::vector AS distance
       FROM events e
       JOIN users u ON u.id = e.host_id
       WHERE ${filters.where}
         AND e.embedding IS NOT NULL
       ORDER BY e.embedding <=> ${vec}::vector
       LIMIT ${lim}
     )
     SELECT * FROM neighbors WHERE distance <= ${maxDistance}`,
    builder.params
  );

  // Cosine distance ascending → similarity descending.
  return rankRows(rows, r => 1 - Number(r.distance));
}

/**
 * Run both retrievers concurrently, isolating failures.
 *
 * @param {object} ctx
 * @param {boolean} [ctx.skipSemantic] Set for `@handle` lookups, where semantic
 *   retrieval is pure cost — there is no vibe to match.
 * @returns {Promise<{lexical: object[], semantic: object[], errors: object}>}
 */
async function retrieve(ctx) {
  const [lexicalResult, semanticResult] = await Promise.allSettled([
    retrieveLexical(ctx),
    ctx.skipSemantic ? Promise.resolve([]) : retrieveSemantic(ctx),
  ]);

  const errors = {};
  let lexical = [];
  let semantic = [];

  if (lexicalResult.status === 'fulfilled') {
    lexical = lexicalResult.value;
  } else {
    errors.lexical = lexicalResult.reason?.message || String(lexicalResult.reason);
  }

  if (semanticResult.status === 'fulfilled') {
    semantic = semanticResult.value;
  } else {
    errors.semantic = semanticResult.reason?.message || String(semanticResult.reason);
  }

  return { lexical, semantic, errors };
}

module.exports = { retrieve, retrieveLexical, retrieveSemantic, rankRows, EVENT_COLUMNS };
