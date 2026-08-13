// Stage 6 — Re-rank.
//
// Blends the fusion score with the behavioral signals. Pure code over rows
// stage 4 already fetched, so this costs no extra round trip.
//
// Every signal is normalized to [0,1] before weighting. That is the whole
// discipline of this stage: an un-normalized signal with a wide range silently
// dominates the blend regardless of its weight, and the failure is invisible
// because the ordering still looks plausible.
//
// Signals:
//   fusion        — stage 5 score, min-max normalized within this result set
//   rsvpVelocity  — RSVPs/hour since publish, log-compressed
//   tagAffinity   — overlap between event hashtags and the viewer's interests
//   recency       — how recently the event was published
//   distanceDecay — exponential falloff from the search center

const {
  RERANK_WEIGHTS,
  DISTANCE_HALF_LIFE_M,
  VELOCITY_WINDOW_HOURS,
} = require('../config');

const HOUR_MS = 3600 * 1000;

/**
 * Min-max normalize, mapping a degenerate range (all values equal) to 1 rather
 * than 0 — if every candidate scores the same, none of them should be penalized.
 * @param {number[]} values
 * @returns {(v: number) => number}
 */
function minMaxNormalizer(values) {
  if (!values.length) return () => 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return () => 1;
  return v => (v - min) / (max - min);
}

/**
 * RSVP velocity: recent RSVPs per hour, log-compressed so a runaway party
 * doesn't flatten everything else to zero after normalization.
 * @param {object} row
 * @param {Date} now
 * @returns {number} raw, un-normalized
 */
function rsvpVelocity(row, now) {
  const recent = Number(row.recent_rsvp_count) || 0;
  if (recent === 0) return 0;
  const publishedAt = row.created_at ? new Date(row.created_at) : null;
  const ageHours = publishedAt
    ? Math.max(1, (now.getTime() - publishedAt.getTime()) / HOUR_MS)
    : VELOCITY_WINDOW_HOURS;
  const perHour = recent / Math.min(ageHours, VELOCITY_WINDOW_HOURS);
  return Math.log1p(perHour);
}

/**
 * Tag affinity: Jaccard-style overlap between the event's hashtags and the
 * viewer's interests, biased toward coverage of the event's tags — a party
 * tagged #techno matching a user who likes techno should score high even if the
 * user has twenty other interests.
 * @param {string[]} eventTags
 * @param {string[]} userInterests
 * @returns {number} 0..1
 */
function tagAffinity(eventTags, userInterests) {
  if (!eventTags?.length || !userInterests?.length) return 0;
  const interests = new Set(userInterests.map(t => String(t).toLowerCase().replace(/^#/, '')));
  const tags = eventTags.map(t => String(t).toLowerCase().replace(/^#/, ''));
  const hits = tags.filter(t => interests.has(t)).length;
  return hits / tags.length;
}

/**
 * Recency of publication, halving every 7 days.
 * @param {object} row
 * @param {Date} now
 * @returns {number} 0..1
 */
function recency(row, now) {
  if (!row.created_at) return 0.5;
  const ageDays = (now.getTime() - new Date(row.created_at).getTime()) / (24 * HOUR_MS);
  if (ageDays < 0) return 1;
  return Math.pow(0.5, ageDays / 7);
}

/**
 * Exponential distance decay from the search center.
 * @param {object} row
 * @param {{lat: number, lng: number}|null} center
 * @returns {number} 0..1; neutral 0.5 when there is no center to measure from
 */
function distanceDecay(row, center) {
  if (!center || row.latitude == null || row.longitude == null) return 0.5;
  const meters = haversineMeters(center.lat, center.lng, Number(row.latitude), Number(row.longitude));
  return Math.pow(0.5, meters / DISTANCE_HALF_LIFE_M);
}

/**
 * Great-circle distance. Mirrors frontend/src/utils/geo.js so client and server
 * agree on what "2 km away" means.
 * @returns {number} meters
 */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * @param {{id: string, row: object, fusionScore: number, sources: object}[]} fused
 * @param {object} ctx
 * @param {Date} ctx.now
 * @param {{lat: number, lng: number}|null} ctx.center
 * @param {string[]} ctx.userInterests
 * @returns {{id: string, row: object, finalScore: number, signals: object, sources: object}[]}
 */
function rerank(fused, ctx) {
  if (!fused.length) return [];

  const { now, center, userInterests = [] } = ctx;

  // Compute raw signals first — normalization needs the whole population.
  const raw = fused.map(item => ({
    ...item,
    _velocity: rsvpVelocity(item.row, now),
  }));

  const normFusion = minMaxNormalizer(raw.map(r => r.fusionScore));
  const normVelocity = minMaxNormalizer(raw.map(r => r._velocity));

  const scored = raw.map(item => {
    const signals = {
      fusion: normFusion(item.fusionScore),
      rsvpVelocity: normVelocity(item._velocity),
      tagAffinity: tagAffinity(item.row.hashtags, userInterests),
      recency: recency(item.row, now),
      distanceDecay: distanceDecay(item.row, center),
    };

    const finalScore = Object.entries(RERANK_WEIGHTS).reduce(
      (acc, [key, weight]) => acc + weight * (signals[key] ?? 0),
      0
    );

    return {
      id: item.id,
      row: item.row,
      finalScore,
      signals,
      sources: item.sources,
      fusionScore: item.fusionScore,
    };
  });

  return scored.sort((a, b) => b.finalScore - a.finalScore);
}

module.exports = {
  rerank,
  tagAffinity,
  rsvpVelocity,
  recency,
  distanceDecay,
  haversineMeters,
  minMaxNormalizer,
};
