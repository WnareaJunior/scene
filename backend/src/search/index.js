// Search pipeline orchestrator.
//
// Composes stages 1–8. The stage-7 fallback lives here rather than in its own
// module because relaxing filters means re-running stages 3–6 — it is control
// flow over the pipeline, not a step within it.
//
//   1 sanitize → 2 parse → 3 filters → 4 retrieve → 5 fuse → 6 rerank
//                                ↑                              │
//                                └──── 7 fallback (once) ───────┘
//                                                               ↓
//                                                            8 log
//
// The one hard invariant: exactly one retry. A ladder that steps radius and time
// separately would cost up to four round trips on the queries that are already
// the slowest, and the marginal recall over relaxing everything at once doesn't
// pay for it.

const { sanitize } = require('./stages/01-sanitize');
const { parse } = require('./stages/02-parse');
const { buildEventFilters, buildRelaxedEventFilters } = require('./stages/03-filters');
const { retrieve } = require('./stages/04-retrieve');
const { fuse } = require('./stages/05-fuse');
const { rerank } = require('./stages/06-rerank');
const { logSearch, summarizeResults } = require('./stages/08-log');
const { resolveHandle } = require('./parse/username');
const {
  WEAK_RESULT_THRESHOLD,
  FALLBACK_RADIUS_MULTIPLIER,
  FALLBACK_TIME_WINDOW_DAYS,
  DEFAULT_RADIUS_M,
} = require('./config');

/**
 * Stages 3–6 as one unit, so the fallback can re-run them against relaxed filters.
 * @returns {Promise<{results: object[], retrieved: object, weights: object, filters: object}>}
 */
async function runRetrievalRound({ db, userId, parsed, rawText, filters, userInterests, now }) {
  const retrieved = await retrieve({
    db,
    text: parsed.cleanedText || rawText,
    filters,
    userId,
    skipSemantic: parsed.entities.usernameExplicit,
  });

  const { results: fused, weights } = fuse(retrieved, parsed, rawText);

  const ranked = rerank(fused, {
    now,
    center: parsed.filters.center,
    userInterests,
  });

  return { results: ranked, retrieved, weights, filters };
}

/**
 * Fetch the viewer's interests for stage 6's tag-affinity signal.
 * @returns {Promise<string[]>}
 */
async function loadUserInterests(db, userId) {
  try {
    const { rows } = await db.query(`SELECT interests FROM users WHERE id = $1`, [userId]);
    return rows[0]?.interests || [];
  } catch {
    return [];
  }
}

/**
 * @typedef {object} SearchOptions
 * @property {string} query        Raw query off the wire
 * @property {string} userId       Viewer
 * @property {{query: Function}} db
 * @property {{lat: number, lng: number, radiusM?: number}|null} [viewport]
 * @property {number} [limit]
 * @property {number} [offset]
 * @property {number} [utcOffsetMinutes] Minutes east of UTC, from the client
 * @property {string} [timezone]   IANA name, passed to the LLM on escalation
 * @property {Date} [now]          Injectable for deterministic tests
 */

/**
 * Run the full pipeline.
 *
 * @param {SearchOptions} opts
 * @returns {Promise<{events: object[], users: object[], meta: object}>}
 */
async function search(opts) {
  const startedAt = Date.now();
  const {
    query,
    userId,
    db,
    viewport = null,
    limit = 20,
    offset = 0,
    utcOffsetMinutes = 0,
    timezone = 'UTC',
    now = new Date(),
  } = opts;

  // ── Stage 1 ───────────────────────────────────────────────────────────────
  const sanitized = sanitize(query);

  if (!sanitized.ok) {
    // Log rejections too — they're the rows abuse review actually needs.
    void logSearch(db, {
      userId,
      rawQuery: sanitized.raw,
      sanitizedQuery: sanitized.text,
      cleanedQuery: null,
      rejected: true,
      rejectionReason: sanitized.reason,
      sanitizeFlags: sanitized.flags,
      parsedEntities: null,
      parseConfidence: null,
      llmEscalated: false,
      appliedFilters: null,
      routeWeights: null,
      lexicalCount: 0,
      semanticCount: 0,
      fusedCount: 0,
      resultsShown: [],
      resultCount: 0,
      fallbackApplied: false,
      retrieverErrors: null,
      latencyMs: Date.now() - startedAt,
    });

    return {
      events: [],
      users: [],
      meta: {
        rejected: true,
        reason: sanitized.reason,
        searchId: null,
        query: sanitized.text,
      },
    };
  }

  // ── Stage 2 ───────────────────────────────────────────────────────────────
  const parsed = await parse(sanitized, {
    db,
    userId,
    now,
    utcOffsetMinutes,
    timezone,
    viewport: viewport
      ? { lat: viewport.lat, lng: viewport.lng, radiusM: viewport.radiusM || DEFAULT_RADIUS_M }
      : null,
  });

  const userInterests = await loadUserInterests(db, userId);

  // ── Stage 3 ───────────────────────────────────────────────────────────────
  const filterInput = {
    userId,
    now,
    startAfter: parsed.filters.startAfter,
    startBefore: parsed.filters.startBefore,
    center: parsed.filters.center,
    radiusM: parsed.filters.radiusM,
  };
  let filters = buildEventFilters(filterInput);

  // ── Stages 4–6 ────────────────────────────────────────────────────────────
  let round = await runRetrievalRound({
    db,
    userId,
    parsed,
    rawText: sanitized.text,
    filters,
    userInterests,
    now,
  });

  // ── Stage 7 — Fallback ────────────────────────────────────────────────────
  // Only for weak *event* results, and never for an explicit handle lookup:
  // "@nobody" returning nothing is the correct answer, and widening the radius
  // cannot produce a user who doesn't exist.
  let fallbackApplied = false;
  const weak = round.results.length < WEAK_RESULT_THRESHOLD;
  const canRelax = parsed.filters.center || parsed.filters.startBefore;

  if (weak && canRelax && !parsed.entities.usernameExplicit) {
    const relaxed = buildRelaxedEventFilters(filterInput, {
      radiusMultiplier: FALLBACK_RADIUS_MULTIPLIER,
      timeWindowDays: FALLBACK_TIME_WINDOW_DAYS,
    });

    const retryRound = await runRetrievalRound({
      db,
      userId,
      parsed,
      rawText: sanitized.text,
      filters: relaxed,
      userInterests,
      now,
    });

    // Keep the retry only if it actually helped. A relaxed search that returns
    // the same count has bought nothing and cost precision.
    if (retryRound.results.length > round.results.length) {
      round = retryRound;
      filters = relaxed;
      fallbackApplied = true;
    }
  }

  // ── Users ─────────────────────────────────────────────────────────────────
  // An explicit @lookup returns the candidates stage 2 already resolved. A plain
  // query still surfaces a small user strip, matching how SearchSheet renders
  // today — but never at the cost of an extra query when there's no handle.
  let users = [];
  if (parsed.entities.usernameExplicit) {
    users = parsed.entities.userCandidates;
  } else if (parsed.entities.username) {
    users = await resolveHandle(parsed.entities.username, db, userId, 5).catch(() => []);
  }

  const paged = round.results.slice(offset, offset + limit);
  const events = paged.map(r => ({
    ...r.row,
    // Diagnostics ride along so the client can log taps with full context and so
    // the relevance harness can assert on ranking without a second call.
    _score: Number(r.finalScore.toFixed(6)),
    _signals: r.signals,
    _sources: r.sources,
  }));

  const latencyMs = Date.now() - startedAt;

  // ── Stage 8 ───────────────────────────────────────────────────────────────
  // Awaited, unlike the rejection path: the response carries searchId so the
  // client can attribute taps, and there's nothing to attribute to without it.
  // Bounded by LOG_TIMEOUT_MS, and a null id degrades to untracked taps.
  const searchId = await logSearch(db, {
    userId,
    rawQuery: sanitized.raw,
    sanitizedQuery: sanitized.text,
    cleanedQuery: parsed.cleanedText,
    rejected: false,
    rejectionReason: null,
    sanitizeFlags: sanitized.flags,
    parsedEntities: parsed.entities,
    parseConfidence: parsed.confidence,
    llmEscalated: parsed.escalated,
    appliedFilters: { ...filters.applied, ...parsed.filters },
    routeWeights: round.weights,
    lexicalCount: round.retrieved.lexical.length,
    semanticCount: round.retrieved.semantic.length,
    fusedCount: round.results.length,
    resultsShown: summarizeResults(paged),
    resultCount: paged.length,
    fallbackApplied,
    retrieverErrors: Object.keys(round.retrieved.errors).length ? round.retrieved.errors : null,
    latencyMs,
  });

  return {
    events,
    users,
    meta: {
      searchId,
      rejected: false,
      query: sanitized.text,
      cleanedQuery: parsed.cleanedText,
      parsed: {
        time: parsed.entities.time,
        timeSource: parsed.entities.timeSource,
        place: parsed.entities.place
          ? { id: parsed.entities.place.id, name: parsed.entities.place.name }
          : null,
        placeSource: parsed.entities.placeSource,
        username: parsed.entities.username,
        vibe: parsed.entities.vibe,
      },
      confidence: parsed.confidence,
      llmEscalated: parsed.escalated,
      routeWeights: round.weights,
      appliedFilters: filters.applied,
      fallbackApplied,
      counts: {
        lexical: round.retrieved.lexical.length,
        semantic: round.retrieved.semantic.length,
        fused: round.results.length,
        returned: paged.length,
      },
      retrieverErrors: Object.keys(round.retrieved.errors).length ? round.retrieved.errors : null,
      latencyMs,
      total: round.results.length,
    },
  };
}

module.exports = { search, runRetrievalRound };
