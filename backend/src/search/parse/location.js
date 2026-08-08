// Stage 2b — Location extraction.
//
// Dictionary lookup against the `neighborhoods` table (see sql/001_search_schema.sql),
// which holds neighborhood polygons/centroids plus an alias list ("bk" → Brooklyn,
// "wburg" → Williamsburg, "les" → Lower East Side).
//
// Exact alias match first, trigram fuzzy match second. The trigram floor is
// deliberately higher than the username one: a false-positive location applies a
// hard geo filter in stage 3, which can empty the result set with no signal to
// the user. Missing a location just means a wider search.
//
// The dictionary is small (hundreds of rows) and changes rarely, so it is cached
// in process for CACHE_TTL_MS. A stale entry costs nothing; a per-query round
// trip to Supabase on every keystroke-debounce costs real latency.

const { LOCATION_MATCH_THRESHOLD } = require('../config');
const { escapeLikePattern } = require('../stages/01-sanitize');

const CACHE_TTL_MS = 10 * 60 * 1000;

/** @type {{rows: object[], loadedAt: number}|null} */
let cache = null;

// Words that look like place names to a trigram matcher but never are. Without
// this, "bar in soho" can trigram-match "bar" against a venue named "Bar Six".
const STOPWORDS = new Set([
  'in', 'at', 'near', 'around', 'by', 'the', 'a', 'an', 'on', 'to', 'from',
  'party', 'parties', 'event', 'events', 'tonight', 'weekend', 'today',
  'tomorrow', 'bar', 'club', 'spot', 'place', 'thing', 'happening',
]);

/**
 * Load and cache the neighborhood/venue dictionary.
 * @param {{query: Function}} db
 * @returns {Promise<object[]>}
 */
async function loadDictionary(db) {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.rows;

  const { rows } = await db.query(
    `SELECT id, name, slug, aliases, city, latitude, longitude, default_radius_m
     FROM neighborhoods
     WHERE is_active = true`
  );
  cache = { rows, loadedAt: Date.now() };
  return rows;
}

/** Test seam — drop the cached dictionary. */
function clearCache() {
  cache = null;
}

/**
 * @typedef {object} LocationParse
 * @property {object|null} place Matching neighborhoods row
 * @property {string|null} matchedText Substring consumed, for entity stripping
 * @property {number} confidence
 * @property {'exact'|'alias'|'trigram'|'none'} source
 */

/**
 * Extract a place from a query.
 *
 * @param {string} text Sanitized query
 * @param {{query: Function}} db
 * @returns {Promise<LocationParse>}
 */
async function extractLocation(text, db) {
  const dictionary = await loadDictionary(db);
  if (!dictionary.length) {
    return { place: null, matchedText: null, confidence: 0, source: 'none' };
  }

  const lower = text.toLowerCase();

  // Pass 1 — exact name or alias appearing as a whole phrase in the query.
  // Longest first so "east village" wins over "village".
  const byLength = [...dictionary].sort((a, b) => b.name.length - a.name.length);
  for (const place of byLength) {
    const candidates = [place.name, ...(place.aliases || [])];
    for (const candidate of candidates) {
      const needle = String(candidate).toLowerCase();
      if (needle.length < 2) continue;
      // Whole-token match only — "so" must not match inside "soho".
      const re = new RegExp(`(?:^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`, 'i');
      const match = text.match(re);
      if (match) {
        return {
          place,
          matchedText: match[0].trim(),
          confidence: needle === place.name.toLowerCase() ? 0.95 : 0.88,
          source: needle === place.name.toLowerCase() ? 'exact' : 'alias',
        };
      }
    }
  }

  // Pass 2 — trigram fuzzy match, for typos ("willaimsburg"). Pushed to Postgres
  // so pg_trgm's similarity() is the single source of truth for the threshold,
  // rather than reimplementing trigram scoring in JS and having the test harness
  // assert against a different definition than production uses.
  const tokens = lower
    .split(/\s+/)
    .filter(t => t.length >= 4 && !STOPWORDS.has(t) && !t.startsWith('@'));
  if (!tokens.length) {
    return { place: null, matchedText: null, confidence: 0, source: 'none' };
  }

  const { rows } = await db.query(
    `SELECT n.id, n.name, n.slug, n.aliases, n.city, n.latitude, n.longitude,
            n.default_radius_m,
            t.token,
            similarity(n.name, t.token) AS sim
     FROM neighborhoods n
     CROSS JOIN unnest($1::text[]) AS t(token)
     WHERE n.is_active = true
       AND similarity(n.name, t.token) >= $2
     ORDER BY sim DESC
     LIMIT 1`,
    [tokens, LOCATION_MATCH_THRESHOLD]
  );

  if (!rows.length) {
    return { place: null, matchedText: null, confidence: 0, source: 'none' };
  }

  const hit = rows[0];
  return {
    place: hit,
    matchedText: hit.token,
    // Scale trigram similarity into the confidence band below exact matches, so
    // a fuzzy location never reads as certain enough to skip LLM escalation.
    confidence: Math.min(0.8, Number(hit.sim)),
    source: 'trigram',
  };
}

/**
 * Resolve an LLM-supplied location string (stage 2 escalation) back onto a real
 * dictionary row. The model returns free text; stage 3 needs coordinates.
 *
 * @param {string} name
 * @param {{query: Function}} db
 * @returns {Promise<object|null>}
 */
async function resolvePlaceName(name, db) {
  const clean = String(name || '').trim();
  if (!clean) return null;

  const { rows } = await db.query(
    `SELECT id, name, slug, aliases, city, latitude, longitude, default_radius_m
     FROM neighborhoods
     WHERE is_active = true
       AND (lower(name) = lower($1)
            OR lower($1) = ANY(SELECT lower(a) FROM unnest(aliases) AS a)
            OR similarity(name, $1) >= $2)
     ORDER BY similarity(name, $1) DESC
     LIMIT 1`,
    [clean, LOCATION_MATCH_THRESHOLD]
  );
  return rows[0] || null;
}

module.exports = { extractLocation, resolvePlaceName, loadDictionary, clearCache, STOPWORDS, escapeLikePattern };
