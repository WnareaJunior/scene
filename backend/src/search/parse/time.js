// Stage 2a — Time extraction.
//
// Uses chrono-node when it is installed. It is NOT currently a dependency:
// adding it means editing backend/package.json, which the agent scope rules put
// off-limits, so this module lazy-requires it and falls back to a built-in
// pattern table covering the phrasings that actually show up in a nightlife
// search box ("tonight", "this weekend", "friday").
//
// To upgrade: `npm i chrono-node` in backend/ — this module picks it up on next
// boot with no code change. The fallback stays as the safety net.
//
// Everything here is timezone-aware via an explicit offset rather than the
// server's local zone: the API runs on Render in UTC, the user is in New York,
// and "tonight" resolving to the wrong day is the single most visible way this
// stage can be wrong.

const { GRACE_PERIOD_MINUTES } = require('../config');

/** @type {null|{parse: Function}} */
let chrono = null;
let chronoChecked = false;

function getChrono() {
  if (chronoChecked) return chrono;
  chronoChecked = true;
  try {
    // eslint-disable-next-line global-require
    chrono = require('chrono-node');
  } catch {
    chrono = null; // not installed — fallback table handles it
  }
  return chrono;
}

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// Nightlife day boundary: a party at 01:00 Saturday belongs to Friday night.
// Windows for "tonight" and friends run to 05:00 the next morning, not midnight.
const NIGHT_END_HOUR = 5;
const EVENING_START_HOUR = 17;

const WEEKDAYS = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

/**
 * Shift an instant into the user's local wall-clock frame so date arithmetic
 * ("start of today") happens in their day, not the server's.
 * @param {Date} date
 * @param {number} offsetMinutes Minutes east of UTC (NYC in summer = -240)
 * @returns {Date} a Date whose UTC fields read as the user's local fields
 */
function toLocalFrame(date, offsetMinutes) {
  return new Date(date.getTime() + offsetMinutes * 60 * 1000);
}

/** Inverse of toLocalFrame. */
function toUtc(localFramed, offsetMinutes) {
  return new Date(localFramed.getTime() - offsetMinutes * 60 * 1000);
}

/**
 * Midnight at the start of the local day containing `local`.
 * @param {Date} local a local-framed Date
 */
function startOfLocalDay(local) {
  const d = new Date(local.getTime());
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Build a window from local-framed bounds, converting back to UTC instants.
 * @returns {{start: Date, end: Date}}
 */
function window(localStart, localEnd, offsetMinutes) {
  return { start: toUtc(localStart, offsetMinutes), end: toUtc(localEnd, offsetMinutes) };
}

/**
 * Ordered pattern table. First match wins, so longer phrases must precede the
 * shorter phrases they contain ("this weekend" before "weekend").
 *
 * Each resolver receives the local-framed `now` and returns local-framed bounds.
 */
const PATTERNS = [
  {
    // "tonight" — from now (or 17:00 if it's still daytime) to 05:00 tomorrow.
    re: /\b(?:to\s?night|this\s+evening)\b/i,
    confidence: 0.95,
    resolve: (now) => {
      const today = startOfLocalDay(now);
      const eveningStart = new Date(today.getTime() + EVENING_START_HOUR * HOUR);
      const start = now > eveningStart ? now : eveningStart;
      return [start, new Date(today.getTime() + DAY + NIGHT_END_HOUR * HOUR)];
    },
  },
  {
    re: /\b(?:to\s?morrow(?:\s+night)?)\b/i,
    confidence: 0.95,
    resolve: (now) => {
      const tomorrow = new Date(startOfLocalDay(now).getTime() + DAY);
      return [tomorrow, new Date(tomorrow.getTime() + DAY + NIGHT_END_HOUR * HOUR)];
    },
  },
  {
    // MUST precede the "weekend" entry below: that pattern's `this` is optional,
    // so it happily matches the "weekend" inside "next weekend" and would
    // resolve the phrase to the wrong week.
    re: /\bnext\s+weekend\b/i,
    confidence: 0.85,
    resolve: (now) => {
      const today = startOfLocalDay(now);
      const dow = today.getUTCDay();
      const toFriday = (5 - dow + 7) % 7 || 7;
      const friday = new Date(today.getTime() + (toFriday + 7) * DAY + EVENING_START_HOUR * HOUR);
      return [friday, new Date(friday.getTime() + 3 * DAY)];
    },
  },
  {
    // "this weekend" — Friday 17:00 through Monday 05:00 of the coming weekend.
    // Asked on a Saturday, it means the weekend you are already in.
    re: /\b(?:this\s+)?weekend\b/i,
    confidence: 0.9,
    resolve: (now) => {
      const today = startOfLocalDay(now);
      const dow = today.getUTCDay();
      // Days until Friday; if it's already Sat/Sun, wind back to the Friday just past.
      const toFriday = dow === 6 ? -1 : dow === 0 ? -2 : 5 - dow;
      const friday = new Date(today.getTime() + toFriday * DAY + EVENING_START_HOUR * HOUR);
      const monday = new Date(today.getTime() + (toFriday + 3) * DAY + NIGHT_END_HOUR * HOUR);
      return [now > friday ? now : friday, monday];
    },
  },
  {
    re: /\bthis\s+week\b/i,
    confidence: 0.8,
    resolve: (now) => {
      const today = startOfLocalDay(now);
      const toSunday = 7 - today.getUTCDay();
      return [now, new Date(today.getTime() + toSunday * DAY + NIGHT_END_HOUR * HOUR)];
    },
  },
  {
    re: /\bnext\s+week\b/i,
    confidence: 0.8,
    resolve: (now) => {
      const today = startOfLocalDay(now);
      const toMonday = ((1 - today.getUTCDay() + 7) % 7) || 7;
      const monday = new Date(today.getTime() + toMonday * DAY);
      return [monday, new Date(monday.getTime() + 7 * DAY)];
    },
  },
  {
    // Bare or "next"-prefixed weekday. Bare means the next occurrence, which for
    // today's weekday means today, not a week out.
    re: /\b(?:(next)\s+)?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/i,
    confidence: 0.75,
    resolve: (now, match) => {
      const isNext = Boolean(match[1]);
      const target = WEEKDAYS[match[2].toLowerCase()];
      const today = startOfLocalDay(now);
      let delta = (target - today.getUTCDay() + 7) % 7;
      if (isNext) delta = delta === 0 ? 7 : delta + 7;
      const day = new Date(today.getTime() + delta * DAY);
      return [delta === 0 ? now : day, new Date(day.getTime() + DAY + NIGHT_END_HOUR * HOUR)];
    },
  },
  {
    re: /\b(?:right\s+now|happening\s+now|now)\b/i,
    confidence: 0.7,
    resolve: (now) => [
      new Date(now.getTime() - GRACE_PERIOD_MINUTES * 60 * 1000),
      new Date(now.getTime() + 6 * HOUR),
    ],
  },
];

/**
 * @typedef {object} TimeParse
 * @property {{start: Date, end: Date}|null} range
 * @property {string|null} matchedText Substring consumed, for entity stripping
 * @property {number} confidence 0 when nothing matched
 * @property {'chrono'|'rules'|'none'} source
 */

/**
 * Extract a date range from a query.
 *
 * @param {string} text Sanitized query
 * @param {{now?: Date, utcOffsetMinutes?: number}} [opts]
 * @returns {TimeParse}
 */
function extractTime(text, opts = {}) {
  const now = opts.now || new Date();
  const offset = Number.isFinite(opts.utcOffsetMinutes) ? opts.utcOffsetMinutes : 0;
  const localNow = toLocalFrame(now, offset);

  // Rules first: they encode the nightlife day boundary (05:00, not midnight),
  // which chrono has no way to know about, and they cover the overwhelming
  // majority of real queries. chrono is the fallback for the long tail
  // ("March 14th", "in two weeks") that the table deliberately doesn't chase.
  for (const pattern of PATTERNS) {
    const match = text.match(pattern.re);
    if (!match) continue;
    const [localStart, localEnd] = pattern.resolve(localNow, match);
    return {
      range: window(localStart, localEnd, offset),
      matchedText: match[0],
      confidence: pattern.confidence,
      source: 'rules',
    };
  }

  const c = getChrono();
  if (c) {
    const results = c.parse(text, now, { forwardDate: true });
    if (results.length) {
      const r = results[0];
      const start = r.start.date();
      // chrono gives an open-ended result for a bare date; close it at the
      // nightlife boundary rather than leaving stage 3 with a half-open range.
      const end = r.end ? r.end.date() : new Date(start.getTime() + DAY + NIGHT_END_HOUR * HOUR);
      return {
        range: { start, end },
        matchedText: r.text,
        // chrono has no confidence score. Certainty about the *implied* day is
        // what matters here, and a bare "the 14th" is genuinely more ambiguous
        // than "tonight", so cap it below the rules tier.
        confidence: r.start.isCertain('day') ? 0.7 : 0.5,
        source: 'chrono',
      };
    }
  }

  return { range: null, matchedText: null, confidence: 0, source: 'none' };
}

module.exports = { extractTime, toLocalFrame, NIGHT_END_HOUR, EVENING_START_HOUR };
