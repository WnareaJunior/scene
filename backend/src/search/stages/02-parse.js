// Stage 2 — Parse.
//
// Rules first, LLM only on escalation. The three extractors run concurrently
// (time is pure CPU, the other two hit Postgres), their confidences combine into
// a single score, and only if that score is below LLM_ESCALATION_THRESHOLD do we
// spend the one API call.
//
// Output is the contract every later stage reads:
//   filters     — hard constraints for stage 3
//   cleanedText — query with entities stripped, for stages 4a/4b
//   entities    — what was found, for stage 5 routing and stage 8 logging
//   confidence  — drives router weights in stage 5
//
// Entity stripping matters more than it looks. "techno tonight in bushwick"
// should embed as "techno", not as the whole string: the time and place are
// already enforced as hard filters, and leaving them in the text makes every
// event in Bushwick look semantically similar regardless of whether it's techno.

const { LLM_ESCALATION_THRESHOLD, DEFAULT_RADIUS_M } = require('../config');
const { extractTime } = require('../parse/time');
const { extractLocation, resolvePlaceName } = require('../parse/location');
const { extractUsername, stripHandle } = require('../parse/username');
const llm = require('../adapters/llm');

/**
 * Combine per-extractor confidences into one score.
 *
 * Not an average: a query where nothing was extracted is not "0% confident", it
 * is a plain keyword search that the lexical retriever handles perfectly well.
 * What we are scoring is "do we understand this query well enough not to ask a
 * model" — so a short, entity-free query scores high, and a long one with
 * partial extraction scores low.
 *
 * @param {{time: object, location: object, username: object}} parts
 * @param {string} cleanedText
 * @returns {number} 0..1
 */
function scoreConfidence(parts, cleanedText) {
  const { time, location, username } = parts;

  // An explicit @handle is fully understood — nothing left to interpret.
  if (username.explicit) return 0.98;

  const extracted = [time.confidence, location.confidence, username.confidence].filter(c => c > 0);
  const residualTokens = cleanedText.split(/\s+/).filter(Boolean).length;

  if (!extracted.length) {
    // Nothing extracted. Short queries are almost certainly a name or a tag and
    // need no interpretation; long ones are prose we probably misread.
    if (residualTokens <= 3) return 0.8;
    if (residualTokens <= 6) return 0.5;
    return 0.3;
  }

  const mean = extracted.reduce((a, b) => a + b, 0) / extracted.length;
  // A long residual after extraction means there is more in the query than we
  // accounted for — discount accordingly.
  const residualPenalty = residualTokens > 5 ? 0.75 : residualTokens > 3 ? 0.9 : 1;
  return Math.min(0.97, mean * residualPenalty);
}

/**
 * Remove the substrings the extractors consumed, plus connective filler left
 * dangling behind them ("in", "on", "near").
 * @param {string} text
 * @param {(string|null)[]} matches
 * @returns {string}
 */
function stripEntities(text, matches) {
  let out = text;
  for (const m of matches) {
    if (!m) continue;
    out = out.replace(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ');
  }
  return out
    .replace(/\s+/g, ' ')
    // Trailing/leading prepositions orphaned by the strip.
    .replace(/(?:^|\s)(?:in|on|at|near|around|by|for|this|next)(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @typedef {object} ParseResult
 * @property {object} filters
 * @property {string} cleanedText
 * @property {object} entities
 * @property {number} confidence
 * @property {boolean} escalated
 * @property {string|null} escalationError
 */

/**
 * @param {import('./01-sanitize').SanitizeResult} sanitized
 * @param {object} ctx
 * @param {{query: Function}} ctx.db
 * @param {string} ctx.userId
 * @param {Date} ctx.now
 * @param {number} ctx.utcOffsetMinutes
 * @param {{lat: number, lng: number, radiusM: number}|null} ctx.viewport
 * @returns {Promise<ParseResult>}
 */
async function parse(sanitized, ctx) {
  const { db, userId, now, utcOffsetMinutes, viewport } = ctx;
  const text = sanitized.text;

  const [time, location, username] = await Promise.all([
    Promise.resolve(extractTime(text, { now, utcOffsetMinutes })),
    extractLocation(text, db).catch(() => ({ place: null, matchedText: null, confidence: 0, source: 'none' })),
    extractUsername(text, db, userId).catch(() => ({ handle: null, candidates: [], explicit: false, matchedText: null, confidence: 0 })),
  ]);

  let cleanedText = stripEntities(stripHandle(text), [time.matchedText, location.matchedText]);
  let confidence = scoreConfidence({ time, location, username }, cleanedText);

  let escalated = false;
  let escalationError = null;
  let llmEntities = null;

  // Escalate only when: we're unsure, the query isn't a handle lookup, and the
  // sanitizer didn't flag it as aimed at the model. That last condition is the
  // whole point of stage 1's injection flag — a suspicious query still gets
  // searched, it just never reaches an LLM.
  const shouldEscalate =
    confidence < LLM_ESCALATION_THRESHOLD &&
    !username.explicit &&
    !sanitized.injectionSuspected &&
    text.length > 0;

  if (shouldEscalate) {
    try {
      llmEntities = await llm.parseQuery(text, {
        now,
        timezone: ctx.timezone || 'UTC',
      });
      escalated = true;
    } catch (err) {
      // Degrade, never fail. The rules result is still a usable parse.
      escalationError = err.message;
    }
  }

  // Merge: the LLM only fills gaps the rules left. It never overrides a
  // high-confidence rules extraction — the rules are deterministic and testable,
  // the model is neither, so on disagreement the rules win.
  const entities = {
    time: time.range,
    timeSource: time.source,
    place: location.place,
    placeSource: location.source,
    username: username.handle,
    usernameExplicit: username.explicit,
    userCandidates: username.candidates,
    vibe: cleanedText || null,
  };

  if (llmEntities) {
    if (!entities.time && llmEntities.time) {
      const start = llmEntities.time.start ? new Date(llmEntities.time.start) : null;
      const end = llmEntities.time.end ? new Date(llmEntities.time.end) : null;
      if (start || end) {
        entities.time = { start: start || now, end };
        entities.timeSource = 'llm';
      }
    }
    if (!entities.place && llmEntities.location) {
      const resolved = await resolvePlaceName(llmEntities.location, db).catch(() => null);
      if (resolved) {
        entities.place = resolved;
        entities.placeSource = 'llm';
      }
    }
    if (!entities.username && llmEntities.username) {
      entities.username = llmEntities.username;
    }
    if (llmEntities.vibe) {
      cleanedText = llmEntities.vibe;
      entities.vibe = llmEntities.vibe;
    }
    // A successful escalation is itself evidence we now understand the query.
    confidence = Math.max(confidence, 0.7);
  }

  // Geo intent: an explicitly named place beats the map viewport. If the user
  // typed "bushwick" while looking at Manhattan, they meant Bushwick.
  const center = entities.place
    ? { lat: Number(entities.place.latitude), lng: Number(entities.place.longitude) }
    : viewport
      ? { lat: viewport.lat, lng: viewport.lng }
      : null;

  const radiusM = entities.place
    ? Number(entities.place.default_radius_m) || DEFAULT_RADIUS_M
    : viewport?.radiusM || DEFAULT_RADIUS_M;

  return {
    filters: {
      startAfter: entities.time?.start || null,
      startBefore: entities.time?.end || null,
      center,
      radiusM,
      // Set only for explicit lookups — an incidental handle match must not
      // restrict the event search to that host.
      username: username.explicit ? entities.username : null,
      geoSource: entities.place ? 'parsed' : viewport ? 'viewport' : 'none',
    },
    cleanedText,
    entities,
    confidence,
    escalated,
    escalationError,
  };
}

module.exports = { parse, scoreConfidence, stripEntities };
