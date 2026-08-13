// Stage 3 — Hard filters.
//
// Builds the WHERE clause both retrievers share, so lexical and semantic search
// run over an identical candidate pool. That identity is what makes RRF valid in
// stage 5: fusing two lists drawn from different populations would let a
// document rank highly in one list purely because the other never saw it.
//
// Returns a builder rather than a string so the caller can keep appending
// retriever-specific params without hand-tracking `$n` offsets — the class of
// bug the existing GET /events route has a comment apologizing for.

const { GRACE_PERIOD_MINUTES, MAX_RADIUS_M } = require('../config');

/**
 * Incremental parameterized-SQL builder. Never interpolates values.
 */
class FilterBuilder {
  constructor(initialParams = []) {
    this.params = [...initialParams];
    this.clauses = [];
  }

  /**
   * @param {(placeholders: string[]) => string} render Receives `$n` strings for
   *   the values just pushed, in order.
   * @param {...unknown} values
   */
  add(render, ...values) {
    const placeholders = values.map(v => {
      this.params.push(v);
      return `$${this.params.length}`;
    });
    this.clauses.push(render(placeholders));
    return this;
  }

  /** Push a value with no clause; returns its placeholder. */
  bind(value) {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  /** Add a clause referencing only already-bound placeholders. */
  addRaw(clause) {
    this.clauses.push(clause);
    return this;
  }

  get where() {
    return this.clauses.length ? this.clauses.join('\n       AND ') : 'true';
  }
}

/**
 * Build the shared event filter.
 *
 * @param {object} opts
 * @param {string} opts.userId Viewer, for block/self exclusion
 * @param {Date} opts.now
 * @param {Date|null} opts.startAfter
 * @param {Date|null} opts.startBefore
 * @param {{lat: number, lng: number}|null} opts.center
 * @param {number} opts.radiusM
 * @param {string[]|null} [opts.hashtags]
 * @returns {{builder: FilterBuilder, where: string, params: unknown[], applied: object}}
 */
function buildEventFilters(opts) {
  const { userId, now, startAfter, startBefore, center, hashtags } = opts;
  const radiusM = Math.min(Math.max(Number(opts.radiusM) || 0, 0), MAX_RADIUS_M);

  const builder = new FilterBuilder();
  const viewer = builder.bind(userId);
  const applied = { time: false, geo: false, hashtags: false, radiusM: null };

  // ── Visibility ────────────────────────────────────────────────────────────
  // Mirrors GET /events exactly. Search must not become a side channel that
  // surfaces private parties or blocked hosts the discover feed hides.
  builder.addRaw(`e.status = 'active'`);
  builder.addRaw(`e.is_private = false`);
  builder.addRaw(`e.host_id != ${viewer}`);
  builder.addRaw(
    `NOT EXISTS (SELECT 1 FROM blocks WHERE blocker_id = ${viewer} AND blocked_id = e.host_id)`
  );
  // Symmetric: a host who blocked the viewer shouldn't surface to them either.
  builder.addRaw(
    `NOT EXISTS (SELECT 1 FROM blocks WHERE blocker_id = e.host_id AND blocked_id = ${viewer})`
  );

  // ── Time ──────────────────────────────────────────────────────────────────
  // Floor is always applied: past events are never candidates. The grace period
  // keeps a party that started an hour ago in the pool — it's still happening.
  const floor = new Date(now.getTime() - GRACE_PERIOD_MINUTES * 60 * 1000);
  const effectiveStart = startAfter && startAfter > floor ? startAfter : floor;
  builder.add(([p]) => `e.start_time >= ${p}`, effectiveStart.toISOString());
  applied.time = Boolean(startAfter);

  if (startBefore) {
    builder.add(([p]) => `e.start_time <= ${p}`, startBefore.toISOString());
  }

  // ── Geo ───────────────────────────────────────────────────────────────────
  // ST_DWithin on the geography column, which is GiST-indexed, so this is an
  // index scan and genuinely narrows the pool before retrieval rather than
  // filtering after it.
  if (center && Number.isFinite(center.lat) && Number.isFinite(center.lng) && radiusM > 0) {
    builder.add(
      ([lng, lat, r]) =>
        `ST_DWithin(e.location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${r})`,
      center.lng,
      center.lat,
      radiusM
    );
    applied.geo = true;
    applied.radiusM = radiusM;
  }

  // ── Tags ──────────────────────────────────────────────────────────────────
  if (hashtags?.length) {
    builder.add(([p]) => `e.hashtags && ${p}`, hashtags);
    applied.hashtags = true;
  }

  return { builder, where: builder.where, params: builder.params, applied, viewerPlaceholder: viewer };
}

/**
 * Relaxed variant for stage 7. Widens the radius and opens the time window, but
 * never touches the visibility clauses — those are correctness, not relevance,
 * and no amount of "no results" justifies leaking a private party.
 *
 * @param {object} opts Same shape as buildEventFilters
 * @param {{radiusMultiplier: number, timeWindowDays: number}} relaxation
 */
function buildRelaxedEventFilters(opts, relaxation) {
  const widened = Math.min(
    (Number(opts.radiusM) || 0) * relaxation.radiusMultiplier,
    MAX_RADIUS_M
  );
  return buildEventFilters({
    ...opts,
    radiusM: widened,
    // Drop the upper time bound entirely and re-cap it far out: "tonight" with
    // nothing on tonight is better answered by "here's this week" than by
    // nothing at all.
    startAfter: null,
    startBefore: new Date(opts.now.getTime() + relaxation.timeWindowDays * 24 * 3600 * 1000),
    hashtags: null,
  });
}

module.exports = { buildEventFilters, buildRelaxedEventFilters, FilterBuilder };
