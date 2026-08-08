// Stage 2c — Username extraction.
//
// Two modes, and the distinction drives routing in stage 5:
//
//   Explicit  — the query starts with `@`. The user is unambiguously looking for
//               a person. Router goes fully lexical, semantic retrieval is
//               skipped, and results are users rather than events.
//   Incidental — a bare token happens to match a handle ("searching for a party
//               thrown by dj_kaya"). Contributes a candidate but does not take
//               over the query.
//
// Matching is exact-prefix first, then pg_trgm. Blocked users are excluded here
// rather than downstream so a blocked handle produces "no such user" instead of
// a filtered-empty result the caller has to explain.

const { USERNAME_MATCH_THRESHOLD } = require('../config');
const { escapeLikePattern } = require('../stages/01-sanitize');

// Matches a handle anywhere, but position tells us whether it's explicit.
const HANDLE_RE = /@([a-zA-Z0-9_.]{1,30})/;

/**
 * @typedef {object} UsernameParse
 * @property {string|null} handle    The extracted handle, without `@`
 * @property {object[]} candidates   Resolved users, best match first
 * @property {boolean} explicit      True when the query is a `@`-prefixed lookup
 * @property {string|null} matchedText
 * @property {number} confidence
 */

/**
 * @param {string} text Sanitized query
 * @param {{query: Function}} db
 * @param {string} viewerId Current user, for block filtering and self-exclusion
 * @returns {Promise<UsernameParse>}
 */
async function extractUsername(text, db, viewerId) {
  const trimmed = text.trim();
  const match = trimmed.match(HANDLE_RE);

  if (!match) {
    return { handle: null, candidates: [], explicit: false, matchedText: null, confidence: 0 };
  }

  const handle = match[1];
  // Explicit when the `@` opens the query — that's the client's own convention
  // in SearchSheet.jsx and the one users have already learned.
  const explicit = trimmed.startsWith('@');

  const candidates = await resolveHandle(handle, db, viewerId);

  // An explicit `@` is a strong signal even when nothing resolves — the intent
  // is unambiguous, so "no such user" beats silently searching events for it.
  let confidence = 0;
  if (explicit) {
    confidence = candidates.length ? 0.95 : 0.85;
  } else if (candidates.length) {
    confidence = Math.min(0.75, Number(candidates[0].sim) || 0.5);
  }

  return { handle, candidates, explicit, matchedText: match[0], confidence };
}

/**
 * Resolve a handle to users. Exact match short-circuits; otherwise prefix and
 * trigram matches are unioned and ranked.
 *
 * @param {string} handle Handle without `@`
 * @param {{query: Function}} db
 * @param {string} viewerId
 * @param {number} [limit]
 * @returns {Promise<object[]>}
 */
async function resolveHandle(handle, db, viewerId, limit = 10) {
  const clean = String(handle || '').trim().replace(/^@/, '');
  if (!clean) return [];

  const prefixPattern = `${escapeLikePattern(clean)}%`;

  const { rows } = await db.query(
    `SELECT u.id, u.username, u.display_name, u.bio, u.profile_picture,
            (SELECT count(*) FROM follows WHERE followed_id = u.id) AS followers_count,
            EXISTS (SELECT 1 FROM follows WHERE follower_id = $3 AND followed_id = u.id) AS is_following,
            GREATEST(
              similarity(u.username, $1),
              COALESCE(similarity(u.display_name, $1), 0)
            ) AS sim,
            (lower(u.username) = lower($1)) AS is_exact
     FROM users u
     WHERE u.id != $3
       AND NOT EXISTS (
         SELECT 1 FROM blocks
         WHERE (blocker_id = $3 AND blocked_id = u.id)
            OR (blocker_id = u.id AND blocked_id = $3)
       )
       AND (
         lower(u.username) = lower($1)
         OR u.username ILIKE $2 ESCAPE '\\'
         OR similarity(u.username, $1) >= $4
         OR similarity(COALESCE(u.display_name, ''), $1) >= $4
       )
     ORDER BY is_exact DESC, sim DESC, followers_count DESC
     LIMIT $5`,
    [clean, prefixPattern, viewerId, USERNAME_MATCH_THRESHOLD, limit]
  );

  return rows;
}

/**
 * Strip a handle out of the query text so it doesn't pollute lexical retrieval
 * or the embedding.
 * @param {string} text
 * @returns {string}
 */
function stripHandle(text) {
  return text.replace(HANDLE_RE, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = { extractUsername, resolveHandle, stripHandle, HANDLE_RE };
